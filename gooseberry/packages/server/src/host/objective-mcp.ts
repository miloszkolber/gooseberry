import type { AskUserQuestionResult, SessionGoal } from "@gooseberry/contracts";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TASKS = 200;
const MAX_TASK_ID_LENGTH = 256;
const MAX_TASK_TEXT_LENGTH = 2_000;
const NON_EMPTY_TEXT_PATTERN = "^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$";

interface ObjectiveOwner {
	projectId: string;
	sessionId: string;
}

interface ObjectiveMcpDependencies {
	sessionForToken: (token: string) => ObjectiveOwner | undefined;
	readObjective: (projectId: string, sessionId: string) => SessionGoal;
	updateObjective: (
		projectId: string,
		sessionId: string,
		update: { goal?: unknown; tasks?: unknown },
	) => unknown;
	askQuestion: (sessionId: string, args: unknown) => Promise<AskUserQuestionResult>;
	onObjectiveUpdated?: (state: SessionGoal) => void;
}

const objectiveUpdateSchema = {
	type: "object",
	properties: {
		goal: {
			type: "string",
			minLength: 1,
			maxLength: MAX_TASK_TEXT_LENGTH,
			pattern: NON_EMPTY_TEXT_PATTERN,
		},
		tasks: {
			type: "array",
			maxItems: MAX_TASKS,
			items: {
				type: "object",
				properties: {
					id: { type: "string", minLength: 1, maxLength: MAX_TASK_ID_LENGTH },
					text: {
						type: "string",
						minLength: 1,
						maxLength: MAX_TASK_TEXT_LENGTH,
						pattern: NON_EMPTY_TEXT_PATTERN,
					},
					status: { enum: ["pending", "active", "done"] },
				},
				required: ["id", "text", "status"],
			},
		},
	},
	minProperties: 1,
	additionalProperties: false,
};

const askUserQuestionSchema = {
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
};

function jsonResponse(id: string | number | null | undefined, result: unknown): Response {
	return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function errorResponse(id: string | number | null | undefined, message: string): Response {
	return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32602, message } });
}

/** Creates the authenticated MCP endpoint for session-scoped Gooseberry objectives. */
export function createObjectiveMcpHandler(
	dependencies: ObjectiveMcpDependencies,
): (req: Request) => Promise<Response> {
	return async (req: Request): Promise<Response> => {
		if (req.method !== "POST")
			return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
		const contentType = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
		if (!contentType || !(contentType === "application/json" || contentType.endsWith("+json")))
			return new Response("content type must be JSON", { status: 415 });
		const authorization = req.headers.get("authorization");
		const token = authorization?.startsWith("Bearer ")
			? authorization.slice("Bearer ".length)
			: undefined;
		const owner = token ? dependencies.sessionForToken(token) : undefined;
		if (!owner) return new Response("unauthorized", { status: 401 });
		if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
			return new Response("payload too large", { status: 413 });

		let request: { id?: string | number | null; method?: string; params?: unknown };
		try {
			const reader = req.body?.getReader();
			if (!reader) return new Response("invalid JSON", { status: 400 });
			const chunks: Uint8Array[] = [];
			let size = 0;
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				size += next.value.byteLength;
				if (size > MAX_BODY_BYTES) {
					await reader.cancel();
					return new Response("payload too large", { status: 413 });
				}
				chunks.push(next.value);
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.length;
			}
			const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
				return new Response("invalid JSON-RPC request", { status: 400 });
			request = parsed as typeof request;
		} catch {
			return new Response("invalid JSON", { status: 400 });
		}

		if (request.method === "initialize")
			return jsonResponse(request.id, {
				protocolVersion: "2025-03-26",
				capabilities: { tools: {} },
				serverInfo: { name: "gooseberry-objectives", version: "1" },
			});
		if (request.method === "notifications/initialized") return new Response(null, { status: 202 });
		if (request.method === "tools/list")
			return jsonResponse(request.id, {
				tools: [
					{
						name: "objective_get",
						description: "Get this session's objective and tasks.",
						inputSchema: { type: "object", properties: {}, additionalProperties: false },
					},
					{
						name: "objective_update",
						description: "Atomically update this session's objective and/or tasks.",
						inputSchema: objectiveUpdateSchema,
					},
					{
						name: "ask_user_question",
						description:
							"Pause and ask the user one or more supporting questions before continuing.",
						inputSchema: askUserQuestionSchema,
					},
				],
			});
		if (request.method !== "tools/call" || !request.params || typeof request.params !== "object")
			return errorResponse(request.id, "Unknown MCP method");

		const params = request.params as { name?: unknown; arguments?: unknown };
		try {
			if (params.name === "ask_user_question") {
				const result = await dependencies.askQuestion(owner.sessionId, params.arguments);
				return jsonResponse(request.id, {
					content: [{ type: "text", text: JSON.stringify(result) }],
					structuredContent: result,
				});
			}
			let state: SessionGoal;
			if (params.name === "objective_get") {
				state = dependencies.readObjective(owner.projectId, owner.sessionId);
			} else if (
				params.name === "objective_update" &&
				params.arguments &&
				typeof params.arguments === "object" &&
				!Array.isArray(params.arguments)
			) {
				const args = params.arguments as { goal?: unknown; tasks?: unknown };
				if (Object.keys(args).some((key) => key !== "goal" && key !== "tasks"))
					return errorResponse(request.id, "Invalid objective update arguments");
				dependencies.updateObjective(owner.projectId, owner.sessionId, args);
				state = dependencies.readObjective(owner.projectId, owner.sessionId);
				dependencies.onObjectiveUpdated?.(state);
			} else {
				return errorResponse(request.id, "Unknown objective tool or invalid arguments");
			}
			return jsonResponse(request.id, {
				content: [{ type: "text", text: JSON.stringify(state) }],
				structuredContent: state,
			});
		} catch (error) {
			return errorResponse(
				request.id,
				error instanceof Error ? error.message : "Objective update failed",
			);
		}
	};
}
