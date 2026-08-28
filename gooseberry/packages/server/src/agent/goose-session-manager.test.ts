import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GooseClient,
	type GooseConnection,
	type GooseConnectionFactory,
} from "@gooseberry/goose-client";
import { setMountedProjectRootsForTesting } from "../path-admission";
import { setDataDirForTests } from "../persistence";
import {
	abortSession,
	createSession,
	disposeAllSessions,
	getSessionMessages,
	gooseRecipes,
	gooseSchedules,
	pendingPermissionSnapshot,
	promptSession,
	requestPermission,
	resolvePermission,
	setGooseClient,
	setObjectiveMcpUrl,
	setPermissionPublisher,
	setPermissionTimeoutForTests,
	setSessionModel,
	setSessionPublisher,
	setSessionThinkingLevel,
	steerSession,
} from "./agent-session-manager";

class FakeConnection implements GooseConnection {
	readonly calls: { method: string; params: Record<string, unknown> }[] = [];
	readonly notifications: { method: string; params: Record<string, unknown> }[] = [];
	#resolveClosed!: () => void;
	readonly closed = new Promise<void>((resolve) => {
		this.#resolveClosed = resolve;
	});
	promptGate: Promise<void> | undefined;
	loadUpdates: ((sessionId: string) => void) | undefined;
	constructor(readonly handlers: Parameters<GooseConnectionFactory["connect"]>[0]) {}
	async request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.calls.push({ method, params });
		if (method === "initialize") return {};
		if (method === "session/new")
			return {
				sessionId: "goose-1",
				configOptions: [
					{ id: "provider", currentValue: "openai", options: [] },
					{ id: "model", currentValue: "gpt", options: [] },
				],
			};
		if (method === "session/load") {
			if (this.loadUpdates) {
				this.loadUpdates(params.sessionId as string);
				return { sessionId: params.sessionId, configOptions: [] };
			}
			this.handlers.onSessionUpdate({
				sessionId: params.sessionId,
				update: { sessionUpdate: "user_message_chunk", content: { text: "saved prompt" } },
			});
			this.handlers.onSessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: "session_info_update",
					_meta: { goose: { activeRunId: "run-1" } },
				},
			});
			this.handlers.onSessionUpdate({
				sessionId: params.sessionId,
				update: { sessionUpdate: "agent_message_chunk", content: { text: "saved answer" } },
			});
			return { sessionId: params.sessionId, configOptions: [] };
		}
		if (method === "session/prompt") {
			await this.promptGate;
			this.handlers.onSessionUpdate({
				sessionId: params.sessionId,
				update: { sessionUpdate: "agent_thought_chunk", content: { text: "reason" } },
			});
			this.handlers.onSessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: "tool_call",
					toolCallId: "tool-1",
					title: "delegate",
					kind: "subagent",
					_meta: { goose: { toolCall: { toolName: "summon_subagent" } } },
					rawInput: { task: "review" },
				},
			});
			this.handlers.onSessionUpdate({
				sessionId: params.sessionId,
				update: {
					sessionUpdate: "tool_call_update",
					toolCallId: "tool-1",
					status: "failed",
					rawOutput: { message: "denied" },
				},
			});
			this.handlers.onGooseNotification("_goose/unstable/session/update", {
				sessionId: params.sessionId,
				update: { sessionUpdate: "message_usage", usage: { inputTokens: 2, outputTokens: 3 } },
			});
			return { stopReason: "end_turn" };
		}
		if (method === "session/set_config_option")
			return { configOptions: [{ id: params.configId, currentValue: params.value, options: [] }] };
		if (method === "_goose/unstable/session/steer") return { runId: "run-2", messageId: "m-2" };
		if (method === "_goose/unstable/recipes/list")
			return {
				recipes: [
					{
						id: "recipe",
						recipe: { title: "Daily", description: "" },
						file_path: "/recipes/daily.yaml",
						last_modified: "2026-01-01T00:00:00Z",
					},
				],
			};
		if (method === "_goose/unstable/schedules/list")
			return {
				jobs: [
					{
						id: "job",
						source: "recipe",
						cron: "* * * * *",
						currentlyRunning: false,
						paused: false,
					},
				],
			};
		if (method === "session/list") return { sessions: [{ sessionId: "goose-1", title: "Chat" }] };
		return {};
	}
	async notify(method: string, params: Record<string, unknown>): Promise<void> {
		this.notifications.push({ method, params });
	}
	close(): void {
		this.#resolveClosed();
	}
	disconnect(): void {
		this.#resolveClosed();
	}
}

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "gooseberry-goose-"));
	setMountedProjectRootsForTesting([directory]);
	setDataDirForTests(join(directory, "state"));
	let connection: FakeConnection | undefined;
	const client = new GooseClient({
		connectionFactory: {
			connect: (handlers) => {
				connection = new FakeConnection(handlers);
				return Promise.resolve(connection);
			},
		},
	});
	setGooseClient(client);
	return {
		directory,
		client,
		get connection() {
			if (!connection) throw new Error("not connected");
			return connection;
		},
	};
}

afterEach(() => {
	setMountedProjectRootsForTesting(undefined);
});

test("Goose create, replay load, prompt stream, cancel, steer, and thinking are projected", async () => {
	const f = fixture();
	const events: string[] = [];
	setSessionPublisher(({ event }) => events.push(event.type));
	const created = await createSession({ projectId: "project", cwd: f.directory });
	disposeAllSessions();
	await getSessionMessages(created.sessionId, "project", f.directory);
	await promptSession(created.sessionId, "new prompt");
	await Promise.resolve();
	await setSessionThinkingLevel(created.sessionId, "high");
	await steerSession(created.sessionId, "continue");
	await abortSession(created.sessionId);
	const loaded = await getSessionMessages(created.sessionId, "project", f.directory);
	expect(loaded.messages.map((message) => message.role)).toEqual([
		"user",
		"assistant",
		"user",
		"assistant",
		"toolResult",
	]);
	expect(events).toEqual(expect.arrayContaining(["thinking", "tool-start", "usage"]));
	expect(f.connection.notifications.map((item) => item.method)).toEqual(["session/cancel"]);
});

test("creating with Goose's active model does not reset unchanged session config", async () => {
	const f = fixture();
	const created = await createSession({
		projectId: "project",
		cwd: f.directory,
		model: {
			provider: "openai",
			id: "gpt",
			name: "GPT",
			available: true,
			hidden: false,
		},
	});
	expect(created.model).toMatchObject({ provider: "openai", id: "gpt" });
	expect(f.connection.calls.map((call) => call.method)).toEqual(["initialize", "session/new"]);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("Goose tool calls preserve exact upstream tool identity, raw input, and failed terminal output", async () => {
	const f = fixture();
	const events: { type: string; toolName?: string }[] = [];
	setSessionPublisher(({ event }) => events.push(event));
	const created = await createSession({ projectId: "project", cwd: f.directory });
	await promptSession(created.sessionId, "run tool");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const loaded = await getSessionMessages(created.sessionId, "project", f.directory);
	const assistant = loaded.messages.find((message) => message.role === "assistant");
	expect(
		assistant?.role === "assistant"
			? assistant.content.find((item) => item.type === "toolCall")
			: undefined,
	).toMatchObject({
		id: "tool-1",
		name: "summon_subagent",
		toolName: "summon_subagent",
		arguments: { task: "review" },
	});
	expect(events).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "tool-start", toolName: "summon_subagent" }),
		]),
	);
	expect(loaded.messages.find((message) => message.role === "toolResult")).toMatchObject({
		toolCallId: "tool-1",
		isError: true,
		content: { message: "denied" },
	});
});

test("an already aborted permission signal is never published or retained", async () => {
	const published: unknown[] = [];
	setPermissionPublisher((request) => published.push(request));
	const controller = new AbortController();
	controller.abort();
	expect(
		await requestPermission(
			{ sessionId: "aborted", toolCall: { toolCallId: "t", raw: {} }, options: [] },
			controller.signal,
		),
	).toBe("cancelled");
	expect(published).toEqual([]);
	expect(pendingPermissionSnapshot()).toEqual([]);
});

test("pending permission snapshots retain the exact request id for reconnect recovery", async () => {
	const published: { id: string }[] = [];
	setPermissionPublisher((request) => published.push(request));
	const pending = requestPermission(
		{
			sessionId: "reconnect",
			toolCall: { toolCallId: "tool", title: "Run command", raw: {} },
			options: [{ optionId: "allow", name: "Allow", kind: "allow_once", raw: {} }],
		},
		new AbortController().signal,
	);
	const id = published[0]?.id;
	if (!id) throw new Error("permission was not published");
	expect(pendingPermissionSnapshot()).toEqual([
		{
			id,
			sessionId: "reconnect",
			toolCallId: "tool",
			title: "Run command",
			options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
		},
	]);
	resolvePermission("reconnect", id, "allow");
	expect(await pending).toEqual({ optionId: "allow" });
	expect(pendingPermissionSnapshot()).toEqual([]);
});

test("permission responses select the exact option id and reject invalid replies", async () => {
	const requests: { id: string; sessionId: string }[] = [];
	setPermissionPublisher((request) => requests.push(request));
	const pending = requestPermission(
		{
			sessionId: "s",
			toolCall: { toolCallId: "t", raw: {} },
			options: [
				{ optionId: "first", name: "Allow", kind: "allow_once", raw: {} },
				{ optionId: "second", name: "Allow this", kind: "allow_once", raw: {} },
			],
		},
		new AbortController().signal,
	);
	expect(() => resolvePermission("s", requests[0]?.id ?? "", "missing")).toThrow(
		"Invalid permission option",
	);
	resolvePermission("s", requests[0]?.id ?? "", "second");
	expect(await pending).toEqual({ optionId: "second" });
	expect(() => resolvePermission("s", requests[0]?.id ?? "", "second")).toThrow(
		"Unknown or expired",
	);
});

test("permission timeout explicitly cancels pending requests", async () => {
	setPermissionTimeoutForTests(1);
	const pending = requestPermission(
		{ sessionId: "timeout", toolCall: { toolCallId: "t", raw: {} }, options: [] },
		new AbortController().signal,
	);
	expect(await pending).toBe("cancelled");
	setPermissionTimeoutForTests(undefined);
});

test("prompt acknowledgement is not held by Goose's long-running prompt request", async () => {
	const f = fixture();
	const events: string[] = [];
	setSessionPublisher(({ event }) => events.push(event.type));
	const created = await createSession({ projectId: "project", cwd: f.directory });
	let release: (() => void) | undefined;
	f.connection.promptGate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await promptSession(created.sessionId, "long running");
	expect(events).toContain("run-start");
	expect(events).not.toContain("complete");
	release?.();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(events).toContain("complete");
});

test("reconnects session attachments once per ACP generation before concurrent operations", async () => {
	const directory = mkdtempSync(join(tmpdir(), "gooseberry-goose-reconnect-"));
	setMountedProjectRootsForTesting([directory]);
	setDataDirForTests(join(directory, "state"));
	const connections: FakeConnection[] = [];
	const client = new GooseClient({
		connectionFactory: {
			connect: (handlers) => {
				const connection = new FakeConnection(handlers);
				connections.push(connection);
				return Promise.resolve(connection);
			},
		},
	});
	setGooseClient(client);
	setObjectiveMcpUrl("http://127.0.0.1:7312/mcp/objective");
	const created = await createSession({ projectId: "project", cwd: directory });
	const first = connections[0];
	if (!first) throw new Error("missing first connection");
	first.disconnect();
	await Promise.resolve();

	await Promise.all([
		setSessionThinkingLevel(created.sessionId, "high"),
		setSessionModel(created.sessionId, {
			provider: "openai",
			id: "gpt-next",
			name: "GPT next",
			available: true,
			hidden: false,
		}),
	]);

	const second = connections[1];
	if (!second) throw new Error("missing reconnect connection");
	expect(second.calls.map((call) => call.method)).toEqual([
		"initialize",
		"session/load",
		"session/set_config_option",
		"session/set_config_option",
		"session/set_config_option",
	]);
	expect(second.calls.filter((call) => call.method === "session/load")).toHaveLength(1);
	expect(second.calls[1]?.params).toMatchObject({
		sessionId: created.sessionId,
		cwd: directory,
		mcpServers: [
			{
				name: "gooseberry-objectives",
				headers: [
					expect.objectContaining({
						name: "Authorization",
						value: expect.stringMatching(/^Bearer /),
					}),
				],
			},
		],
	});
	disposeAllSessions();
	setObjectiveMcpUrl(undefined);
	rmSync(directory, { recursive: true, force: true });
});

test("reconnect replay atomically replaces history without republishing or duplicating it", async () => {
	const directory = mkdtempSync(join(tmpdir(), "gooseberry-goose-replay-"));
	setMountedProjectRootsForTesting([directory]);
	setDataDirForTests(join(directory, "state"));
	const connections: FakeConnection[] = [];
	const client = new GooseClient({
		connectionFactory: {
			connect: (handlers) => {
				const connection = new FakeConnection(handlers);
				connection.loadUpdates = (sessionId) => {
					connection.handlers.onSessionUpdate({
						sessionId,
						update: { sessionUpdate: "user_message_chunk", content: { text: "inspect" } },
					});
					for (const data of ["AA==", "AQ=="])
						connection.handlers.onSessionUpdate({
							sessionId,
							update: {
								sessionUpdate: "user_message_chunk",
								content: { type: "image", data, mimeType: "image/png" },
							},
						});
					connection.handlers.onSessionUpdate({
						sessionId,
						update: { sessionUpdate: "agent_thought_chunk", content: { text: "reason" } },
					});
					connection.handlers.onSessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "tool_call",
							toolCallId: "tool-1",
							_meta: { goose: { toolCall: { toolName: "summon_subagent" } } },
							rawInput: { task: "review" },
						},
					});
					connection.handlers.onSessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "tool_call_update",
							toolCallId: "tool-1",
							status: "failed",
							rawOutput: { message: "denied" },
						},
					});
					connection.handlers.onSessionUpdate({
						sessionId,
						update: {
							sessionUpdate: "agent_message_chunk",
							content: { type: "text", text: "after tool" },
						},
					});
				};
				connections.push(connection);
				return Promise.resolve(connection);
			},
		},
	});
	setGooseClient(client);
	const created = await createSession({ projectId: "project", cwd: directory });
	await promptSession(created.sessionId, "inspect", [
		{ type: "image", data: "AA==", mimeType: "image/png" },
		{ type: "image", data: "AQ==", mimeType: "image/png" },
	]);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const first = connections[0];
	if (!first) throw new Error("missing first connection");
	first.handlers.onSessionUpdate({
		sessionId: created.sessionId,
		update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "after tool" } },
	});
	const before = structuredClone(
		(await getSessionMessages(created.sessionId, "project", directory)).messages,
	);
	const published: unknown[] = [];
	setSessionPublisher((event) => published.push(event));
	first.disconnect();
	await Promise.resolve();
	const beforeReattachEvents = structuredClone(published);
	await setSessionThinkingLevel(created.sessionId, "high");
	const after = (await getSessionMessages(created.sessionId, "project", directory)).messages;

	expect(after).toEqual(before);
	expect(published).toEqual(beforeReattachEvents);
	expect(connections[1]?.calls.filter((call) => call.method === "session/load")).toHaveLength(1);
	disposeAllSessions();
	rmSync(directory, { recursive: true, force: true });
});

test("text-first multi-image user echoes remain one optimistic user message", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	const images = [
		{ type: "image" as const, data: "AA==", mimeType: "image/png" },
		{ type: "image" as const, data: "AQ==", mimeType: "image/png" },
	];
	await promptSession(created.sessionId, "inspect", images);
	f.connection.handlers.onSessionUpdate({
		sessionId: created.sessionId,
		update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: "inspect" } },
	});
	for (const image of [...images].reverse())
		f.connection.handlers.onSessionUpdate({
			sessionId: created.sessionId,
			update: { sessionUpdate: "user_message_chunk", content: image },
		});
	const users = (
		await getSessionMessages(created.sessionId, "project", f.directory)
	).messages.filter((message) => message.role === "user");
	expect(users).toEqual([
		{ role: "user", content: [{ type: "text", text: "inspect" }, ...images] },
	]);
});

test("replay preserves images and alternating assistant content block order", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	f.connection.loadUpdates = (sessionId) => {
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "user_message_chunk",
				content: { type: "image", data: "AA==", mimeType: "image/png" },
			},
		});
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "user_message_chunk",
				content: { type: "text", text: "inspect this" },
			},
		});
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "first" } },
		});
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "agent_message_chunk",
				content: { type: "image", data: "AA==", mimeType: "image/png" },
			},
		});
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: { sessionUpdate: "agent_thought_chunk", content: { text: "plan" } },
		});
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: {
				sessionUpdate: "tool_call",
				toolCallId: "tool-1",
				_meta: { goose: { toolCall: { toolName: "read" } } },
			},
		});
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: { sessionUpdate: "agent_thought_chunk", content: { text: "check" } },
		});
		f.connection.handlers.onSessionUpdate({
			sessionId,
			update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "last" } },
		});
	};
	disposeAllSessions();
	const loaded = await getSessionMessages(created.sessionId, "project", f.directory);
	expect(loaded.messages).toEqual([
		{
			role: "user",
			content: [
				{ type: "image", data: "AA==", mimeType: "image/png" },
				{ type: "text", text: "inspect this" },
			],
		},
		{
			role: "assistant",
			content: [
				{ type: "text", text: "first" },
				{ type: "image", data: "AA==", mimeType: "image/png" },
				{ type: "thinking", thinking: "plan" },
				{ type: "toolCall", id: "tool-1", toolName: "read", name: "read", arguments: {} },
				{ type: "thinking", thinking: "check" },
				{ type: "text", text: "last" },
			],
		},
	]);
});

test("Goose recipe and schedule adapters use the native custom methods", async () => {
	fixture();
	expect((await gooseRecipes().listRecipes())[0]?.id).toBe("recipe");
	expect((await gooseSchedules().listSchedules())[0]?.id).toBe("job");
});

test("an unconfigured Goose client fails clearly", async () => {
	setGooseClient(undefined);
	delete process.env.GOOSEBERRY_GOOSE_SECRET_KEY;
	expect(() => gooseRecipes()).toThrow("Goose is not configured");
});
