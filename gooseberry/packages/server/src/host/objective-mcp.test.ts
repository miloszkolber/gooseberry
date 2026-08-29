import { describe, expect, test } from "bun:test";
import type { SessionGoal, SessionTask } from "@gooseberry/contracts";
import { createObjectiveMcpHandler } from "./objective-mcp";

const endpoint = "http://gooseberry.test/mcp/objective";
const maxBodyBytes = 1024 * 1024;
const encoder = new TextEncoder();

function copyState(state: SessionGoal): SessionGoal {
	return { ...state, tasks: state.tasks.map((task) => ({ ...task })) };
}

function createHandler(): {
	handler: (req: Request) => Promise<Response>;
	stateFor: (projectId: string, sessionId: string) => SessionGoal;
} {
	const owners = new Map([
		["token-a", { projectId: "project-a", sessionId: "session-a" }],
		["token-b", { projectId: "project-b", sessionId: "session-b" }],
	]);
	const states = new Map<string, SessionGoal>();
	let updatedAt = 1;
	const stateFor = (projectId: string, sessionId: string): SessionGoal => {
		const key = `${projectId}\0${sessionId}`;
		const state = states.get(key) ?? {
			projectId,
			sessionId,
			goal: null,
			tasks: [],
			updatedAt: null,
		};
		return copyState(state);
	};
	const normalizeTasks = (value: unknown): SessionTask[] => {
		if (!Array.isArray(value) || value.length > 200) throw new Error("Task list is invalid");
		const tasks = value.map((candidate) => {
			if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
				throw new Error("Task is invalid");
			const id = Reflect.get(candidate, "id");
			const rawText = Reflect.get(candidate, "text");
			const status = Reflect.get(candidate, "status");
			if (typeof id !== "string" || !id || id.length > 256) throw new Error("Task id is invalid");
			if (typeof rawText !== "string") throw new Error("Task text is invalid");
			const text = rawText.trim();
			if (!text || text.length > 2_000 || text.includes("\0"))
				throw new Error("Task text is invalid");
			if (status !== "pending" && status !== "active" && status !== "done")
				throw new Error("Task status is invalid");
			return { id, text, status };
		});
		if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
			throw new Error("Task ids must be unique");
		return tasks;
	};
	return {
		handler: createObjectiveMcpHandler({
			sessionForToken: (token) => owners.get(token),
			readObjective: stateFor,
			updateObjective: (projectId, sessionId, update) => {
				if (!("goal" in update) && !("tasks" in update))
					throw new Error("An objective update requires goal or tasks");
				const current = stateFor(projectId, sessionId);
				let goal = current.goal;
				if ("goal" in update) {
					if (typeof update.goal !== "string") throw new Error("Session goal must be text");
					goal = update.goal.trim();
					if (!goal) throw new Error("Session goal cannot be empty");
					if (goal.includes("\0")) throw new Error("Session goal contains an invalid character");
					if (goal.length > 2_000) throw new Error("Session goal must be 2000 characters or fewer");
				}
				const tasks = "tasks" in update ? normalizeTasks(update.tasks) : current.tasks;
				states.set(`${projectId}\0${sessionId}`, {
					projectId,
					sessionId,
					goal,
					tasks,
					updatedAt: updatedAt++,
				});
			},
			askQuestion: async () => ({
				answers: [{ questionIndex: 0, question: "Proceed?", kind: "option", answer: "Yes" }],
				cancelled: false,
			}),
		}),
		stateFor,
	};
}

function request(
	body: BodyInit | null,
	options: {
		method?: string;
		token?: string | undefined;
		contentType?: string | undefined;
		headers?: HeadersInit;
	} = {},
): Request {
	const method = options.method ?? "POST";
	const token = "token" in options ? options.token : "token-a";
	const contentType = "contentType" in options ? options.contentType : "application/json";
	const headers = options.headers ?? {};
	const requestHeaders = new Headers(headers);
	if (token !== undefined) requestHeaders.set("authorization", `Bearer ${token}`);
	if (contentType !== undefined) requestHeaders.set("content-type", contentType);
	return new Request(endpoint, { method, headers: requestHeaders, body });
}

function rpc(method: string, params?: unknown, id: string | number | null = 1): string {
	return JSON.stringify({
		jsonrpc: "2.0",
		id,
		method,
		...(params === undefined ? {} : { params }),
	});
}

function stream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(chunk);
			controller.close();
		},
	});
}

async function responseJson(response: Response): Promise<unknown> {
	return response.json();
}

describe("objective MCP endpoint", () => {
	test("accepts POST only and advertises it", async () => {
		const { handler } = createHandler();
		const response = await handler(request(null, { method: "GET" }));
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
	});

	test("requires application/json or a +json content type", async () => {
		const { handler } = createHandler();
		const body = rpc("initialize");
		expect(
			(await handler(request(body, { contentType: "application/vnd.mcp+json; charset=utf-8" })))
				.status,
		).toBe(200);
		const withoutContentType = request(stream([encoder.encode(body)]), { contentType: undefined });
		expect(withoutContentType.headers.get("content-type")).toBeNull();
		expect((await handler(withoutContentType)).status).toBe(415);
		expect((await handler(request(body, { contentType: "text/plain" }))).status).toBe(415);
	});

	test("rejects malformed, empty, and non-object JSON", async () => {
		const { handler } = createHandler();
		for (const body of ["{", "", "[]", "null"]) {
			const response = await handler(request(body));
			expect(response.status).toBe(400);
		}
	});

	test("bounds declared and streamed request bodies", async () => {
		const { handler } = createHandler();
		const declared = await handler(
			request("{}", { headers: { "content-length": String(maxBodyBytes + 1) } }),
		);
		expect(declared.status).toBe(413);
		const streamed = await handler(
			request(stream([encoder.encode("{"), new Uint8Array(maxBodyBytes)]), {
				headers: { "content-length": "" },
			}),
		);
		expect(streamed.status).toBe(413);
	});

	test("requires a bound bearer token and prevents cross-session access", async () => {
		const { handler, stateFor } = createHandler();
		const body = rpc("tools/call", { name: "objective_get" });
		for (const headers of [
			{},
			{ authorization: "Basic token-a" },
			{ authorization: "Bearer" },
			{ authorization: "Bearer " },
			{ authorization: "bearer token-a" },
			{ authorization: "Bearer unknown" },
		]) {
			const response = await handler(
				request(body, {
					token: undefined,
					headers: { "content-type": "application/json", ...headers },
				}),
			);
			expect(response.status).toBe(401);
		}
		await handler(
			request(rpc("tools/call", { name: "objective_update", arguments: { goal: "only A" } })),
		);
		expect(stateFor("project-a", "session-a").goal).toBe("only A");
		const other = await handler(request(body, { token: "token-b" }));
		expect(await responseJson(other)).toMatchObject({
			result: { structuredContent: { projectId: "project-b", sessionId: "session-b", goal: null } },
		});
	});

	test("implements initialize and initialized notification responses", async () => {
		const { handler } = createHandler();
		const initialized = await handler(request(rpc("initialize", undefined, "init-id")));
		expect(await responseJson(initialized)).toEqual({
			jsonrpc: "2.0",
			id: "init-id",
			result: {
				protocolVersion: "2025-03-26",
				capabilities: { tools: {} },
				serverInfo: { name: "gooseberry-objectives", version: "1" },
			},
		});
		const notification = await handler(request(rpc("notifications/initialized", undefined, null)));
		expect(notification.status).toBe(202);
		expect(await notification.text()).toBe("");
	});

	test("lists the exact objective tool schemas", async () => {
		const { handler } = createHandler();
		const response = await handler(request(rpc("tools/list", undefined, 7)));
		expect(await responseJson(response)).toEqual({
			jsonrpc: "2.0",
			id: 7,
			result: {
				tools: [
					{
						name: "objective_get",
						description: "Get this session's objective and tasks.",
						inputSchema: { type: "object", properties: {}, additionalProperties: false },
					},
					{
						name: "objective_update",
						description: "Atomically update this session's objective and/or tasks.",
						inputSchema: {
							type: "object",
							properties: {
								goal: {
									type: "string",
									minLength: 1,
									maxLength: 2_000,
									pattern: "^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$",
								},
								tasks: {
									type: "array",
									maxItems: 200,
									items: {
										type: "object",
										properties: {
											id: { type: "string", minLength: 1, maxLength: 256 },
											text: {
												type: "string",
												minLength: 1,
												maxLength: 2_000,
												pattern: "^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$",
											},
											status: { enum: ["pending", "active", "done"] },
										},
										required: ["id", "text", "status"],
									},
								},
							},
							minProperties: 1,
							additionalProperties: false,
						},
					},
					{
						name: "ask_user_question",
						description:
							"Pause and ask the user one or more supporting questions before continuing.",
						inputSchema: {
							type: "object",
							properties: {
								questions: {
									type: "array",
									minItems: 1,
									maxItems: 8,
									items: {
										type: "object",
										properties: {
											question: { type: "string", minLength: 1, maxLength: 2_000 },
											header: { type: "string", minLength: 1, maxLength: 200 },
											options: {
												type: "array",
												minItems: 1,
												maxItems: 12,
												items: {
													type: "object",
													properties: {
														label: { type: "string", minLength: 1, maxLength: 500 },
														description: { type: "string", maxLength: 2_000 },
														preview: { type: "string", maxLength: 8_000 },
														recommendedReason: { type: "string", maxLength: 2_000 },
													},
													required: ["label", "description"],
													additionalProperties: false,
												},
											},
											multiSelect: { type: "boolean" },
										},
										required: ["question", "header", "options"],
										additionalProperties: false,
									},
								},
							},
							required: ["questions"],
							additionalProperties: false,
						},
					},
				],
			},
		});
	});

	test("gets and atomically updates the bound session objective", async () => {
		const { handler, stateFor } = createHandler();
		const first = await handler(request(rpc("tools/call", { name: "objective_get" }, "get-id")));
		expect(await responseJson(first)).toEqual({
			jsonrpc: "2.0",
			id: "get-id",
			result: {
				content: [
					{
						type: "text",
						text: JSON.stringify({
							projectId: "project-a",
							sessionId: "session-a",
							goal: null,
							tasks: [],
							updatedAt: null,
						}),
					},
				],
				structuredContent: {
					projectId: "project-a",
					sessionId: "session-a",
					goal: null,
					tasks: [],
					updatedAt: null,
				},
			},
		});
		const tasks = [{ id: "one", text: "Verify", status: "active" }];
		await handler(
			request(rpc("tools/call", { name: "objective_update", arguments: { goal: "Build" } })),
		);
		await handler(request(rpc("tools/call", { name: "objective_update", arguments: { tasks } })));
		expect(stateFor("project-a", "session-a")).toMatchObject({ goal: "Build", tasks });
		await handler(
			request(
				rpc("tools/call", {
					name: "objective_update",
					arguments: { goal: "Ship", tasks: [{ id: "two", text: "Release", status: "done" }] },
				}),
			),
		);
		const expected = stateFor("project-a", "session-a");
		expect(expected).toMatchObject({
			goal: "Ship",
			tasks: [{ id: "two", text: "Release", status: "done" }],
		});
		for (const arguments_ of [
			{ extra: true },
			{},
			{ goal: "" },
			{ goal: 1 },
			{ tasks: "not a task list" },
			{ tasks: [{ id: "two", text: "", status: "done" }] },
		]) {
			const response = await handler(
				request(rpc("tools/call", { name: "objective_update", arguments: arguments_ })),
			);
			expect(await responseJson(response)).toMatchObject({
				jsonrpc: "2.0",
				error: { code: -32602 },
			});
			expect(stateFor("project-a", "session-a")).toEqual(expected);
		}
	});

	test("returns JSON-RPC errors for unknown methods and tools", async () => {
		const { handler } = createHandler();
		const unknownMethod = await handler(request(rpc("resources/list", undefined, 12)));
		expect(await responseJson(unknownMethod)).toEqual({
			jsonrpc: "2.0",
			id: 12,
			error: { code: -32602, message: "Unknown MCP method" },
		});
		const unknownTool = await handler(
			request(rpc("tools/call", { name: "objective_delete", arguments: {} }, "tool-id")),
		);
		expect(await responseJson(unknownTool)).toEqual({
			jsonrpc: "2.0",
			id: "tool-id",
			error: { code: -32602, message: "Unknown objective tool or invalid arguments" },
		});
	});
});

test("returns a supporting-question answer to the bound Goose session", async () => {
	const { handler } = createHandler();
	const response = await handler(
		request(
			rpc("tools/call", {
				name: "ask_user_question",
				arguments: {
					questions: [
						{
							question: "Proceed?",
							header: "Decision",
							options: [{ label: "Yes", description: "Continue" }],
						},
					],
				},
			}),
		),
	);
	const result = {
		answers: [{ questionIndex: 0, question: "Proceed?", kind: "option", answer: "Yes" }],
		cancelled: false,
	};
	expect(await responseJson(response)).toEqual({
		jsonrpc: "2.0",
		id: 1,
		result: {
			content: [{ type: "text", text: JSON.stringify(result) }],
			structuredContent: result,
		},
	});
});
