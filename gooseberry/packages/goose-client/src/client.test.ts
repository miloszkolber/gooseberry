import { expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { GooseClient, GooseConnectionLostError } from "./client";
import type {
	GooseConnection,
	GooseConnectionFactory,
	GoosePermissionHandler,
	GooseUpdate,
} from "./types";

class FakeConnection implements GooseConnection {
	readonly calls: { method: string; params: Record<string, unknown> }[] = [];
	readonly notifications: { method: string; params: Record<string, unknown> }[] = [];
	#resolveClosed!: () => void;
	readonly closed = new Promise<void>((resolve) => {
		this.#resolveClosed = resolve;
	});
	#pending: Promise<unknown> | undefined;
	#pendingMethod = "session/list";
	readonly responses = new Map<string, unknown>();
	constructor(readonly handlers: Parameters<GooseConnectionFactory["connect"]>[0]) {}
	request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.calls.push({ method, params });
		if (this.responses.has(method)) return Promise.resolve(this.responses.get(method));
		if (method === this.#pendingMethod && this.#pending) return this.#pending;
		if (method === "initialize") return Promise.resolve({ protocolVersion: 1 });
		if (method === "session/new")
			return Promise.resolve({ sessionId: "new-session", configOptions: [] });
		if (method === "session/prompt") return Promise.resolve({ stopReason: "end_turn" });
		if (method === "session/load") return Promise.resolve({ configOptions: [] });
		if (method === "session/fork") return Promise.resolve({ sessionId: "forked-session" });
		if (method === "session/set_config_option")
			return Promise.resolve({
				configOptions: [{ id: params.configId, currentValue: params.value, options: [] }],
			});
		if (method === "_goose/unstable/session/steer")
			return Promise.resolve({ runId: "run-2", messageId: "queued-1" });
		return Promise.resolve({});
	}
	notify(method: string, params: Record<string, unknown>): Promise<void> {
		this.notifications.push({ method, params });
		return Promise.resolve();
	}
	close(): void {
		this.#resolveClosed();
	}
	setPendingRequest(method = "session/list"): void {
		this.#pendingMethod = method;
		this.#pending = new Promise(() => {});
	}
	setResponse(method: string, response: unknown): void {
		this.responses.set(method, response);
	}
	disconnect(): void {
		this.#resolveClosed();
	}
}

function fake(permissionHandler: GoosePermissionHandler = () => ({ optionId: "allow" })): {
	client: GooseClient;
	connection: FakeConnection;
} {
	let connection: FakeConnection | undefined;
	const factory: GooseConnectionFactory = {
		connect(handlers) {
			connection = new FakeConnection(handlers);
			return Promise.resolve(connection);
		},
	};
	return {
		client: new GooseClient({ connectionFactory: factory, permissionHandler }),
		get connection() {
			if (!connection) throw new Error("not connected");
			return connection;
		},
	};
}

test("initializes and creates a session through ACP", async () => {
	const fixture = fake();
	const session = await fixture.client.createSession({ cwd: "/workspace", title: "Chat" });
	expect(session.session.sessionId).toBe("new-session");
	expect(fixture.connection.calls.map((call) => call.method)).toEqual([
		"initialize",
		"session/new",
	]);
	expect(fixture.connection.calls[0]?.params.protocolVersion).toBe(PROTOCOL_VERSION);
	expect(fixture.connection.calls[1]?.params).toMatchObject({
		cwd: "/workspace",
		mcpServers: [],
		_meta: { sessionTitle: "Chat" },
	});
});

test("uses the pinned Goose session lifecycle custom methods", async () => {
	const fixture = fake();
	await fixture.client.renameSession("session-1", "Focused title");
	await fixture.client.archiveSession("session-1");
	await fixture.client.unarchiveSession("session-1");
	expect(fixture.connection.calls.slice(-3)).toEqual([
		{
			method: "_goose/unstable/session/rename",
			params: { sessionId: "session-1", title: "Focused title" },
		},
		{ method: "_goose/unstable/session/archive", params: { sessionId: "session-1" } },
		{ method: "_goose/unstable/session/unarchive", params: { sessionId: "session-1" } },
	]);
});

test("normalizes streamed text, thinking, tools, and Goose usage", async () => {
	const fixture = fake();
	const updates: string[] = [];
	const normalized: GooseUpdate[] = [];
	fixture.client.on((event) => {
		if (event.type === "update") {
			updates.push(event.update.type);
			normalized.push(event.update);
		}
	});
	await fixture.client.ready();
	await fixture.client.prompt("s", "answer this", [
		{ data: "iVBORw0KGgo=", mimeType: "image/png" },
	]);
	expect(fixture.connection.calls.at(-1)?.params).toEqual({
		sessionId: "s",
		prompt: [
			{ type: "text", text: "answer this" },
			{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
		],
	});
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: { sessionUpdate: "agent_message_chunk", content: { text: "hello" } },
	});
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: { sessionUpdate: "agent_thought_chunk", content: { text: "reasoning" } },
	});
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: {
			sessionUpdate: "tool_call",
			toolCallId: "t",
			title: "Read file",
			kind: "read",
			_meta: { goose: { toolCall: { toolName: "filesystem_read" } } },
			rawInput: { path: "src/main.ts" },
			content: [{ type: "content", content: { type: "text", text: "reading" } }],
			locations: [{ path: "src/main.ts", line: 1 }],
		},
	});
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: {
			sessionUpdate: "tool_call_update",
			toolCallId: "t",
			status: "completed",
			content: [{ type: "content", content: { type: "text", text: "done" } }],
			error: null,
			rawOutput: { bytes: 42 },
		},
	});
	fixture.connection.handlers.onGooseNotification("_goose/unstable/session/update", {
		sessionId: "s",
		update: {
			sessionUpdate: "message_usage",
			messageId: "m",
			usage: { inputTokens: 2, outputTokens: 3 },
		},
	});
	expect(updates).toEqual(["text", "thinking", "tool-call", "tool-update", "usage"]);
	expect(normalized[2]).toMatchObject({
		type: "tool-call",
		toolName: "filesystem_read",
		kind: "read",
		rawInput: { path: "src/main.ts" },
		locations: [{ path: "src/main.ts", line: 1 }],
	});
	expect(normalized[3]).toMatchObject({
		type: "tool-update",
		status: "completed",
		error: null,
		rawOutput: { bytes: 42 },
	});
});

test("loads a session with caller-provided MCP servers and accepts replay updates before the response", async () => {
	const fixture = fake();
	const replay: string[] = [];
	fixture.client.on((event) => {
		if (event.type === "update") replay.push(event.update.type);
	});
	await fixture.client.ready();
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "saved",
		update: { sessionUpdate: "user_message_chunk", content: { text: "old prompt" } },
	});
	const session = await fixture.client.loadSession("saved", "/workspace", {
		mcpServers: [{ name: "docs", command: "/bin/docs-mcp", args: ["--serve"], env: [] }],
	});
	expect(session.session.sessionId).toBe("saved");
	expect(replay).toEqual(["text"]);
	expect(fixture.connection.calls.at(-1)?.params).toEqual({
		sessionId: "saved",
		cwd: "/workspace",
		mcpServers: [{ name: "docs", command: "/bin/docs-mcp", args: ["--serve"], env: [] }],
	});
});

test("uses ACP's unstable fork method name", async () => {
	const fixture = fake();
	const session = await fixture.client.forkSession("source", "/workspace");
	expect(session.session.sessionId).toBe("forked-session");
	expect(fixture.connection.calls.at(-1)).toEqual({
		method: "session/fork",
		params: { sessionId: "source", cwd: "/workspace", mcpServers: [] },
	});
});

test("passes fork MCP servers through the pinned ACP request", async () => {
	const fixture = fake();
	const mcpServers = [
		{ type: "http" as const, name: "objectives", url: "http://127.0.0.1:7312/mcp", headers: [] },
	] as const;
	await fixture.client.forkSession("source", "/workspace", { mcpServers });
	expect(fixture.connection.calls.at(-1)?.params).toEqual({
		sessionId: "source",
		cwd: "/workspace",
		mcpServers,
	});
});

test("normalizes the forked session information returned by Goose", async () => {
	const fixture = fake();
	await fixture.client.ready();
	fixture.connection.setResponse("session/fork", {
		sessionId: "forked-session",
		session: { sessionId: "forked-session", title: "Fork of source" },
		configOptions: [
			{ id: "provider", currentValue: "openai", options: [] },
			{ id: "model", currentValue: "gpt-next", options: [] },
		],
	});
	await expect(fixture.client.forkSession("source", "/workspace")).resolves.toMatchObject({
		session: { sessionId: "forked-session", title: "Fork of source" },
		providerId: "openai",
		modelId: "gpt-next",
	});
});

test("passes opaque session cursors through and returns Goose's next cursor", async () => {
	const fixture = fake();
	await fixture.client.ready();
	fixture.connection.setResponse("session/list", {
		sessions: [{ sessionId: "s", cwd: "/workspace" }],
		nextCursor: "opaque-next-page",
	});
	await expect(
		fixture.client.listSessions({ cwd: "/workspace", cursor: "opaque-current-page", limit: 25 }),
	).resolves.toMatchObject({
		sessions: [{ sessionId: "s" }],
		nextCursor: "opaque-next-page",
	});
	expect(fixture.connection.calls.at(-1)).toEqual({
		method: "session/list",
		params: { cwd: "/workspace", cursor: "opaque-current-page", limit: 25 },
	});
});

test("projects Goose v1.48 session metadata from the ACP _meta object", async () => {
	const fixture = fake();
	await fixture.client.ready();
	fixture.connection.setResponse("session/list", {
		sessions: [
			{
				sessionId: "archived",
				title: "Stored chat",
				updatedAt: "2026-08-29T12:00:00Z",
				_meta: {
					archivedAt: "2026-08-29T12:01:00Z",
					createdAt: "2026-08-28T12:00:00Z",
					messageCount: 4,
					projectId: "project",
				},
			},
		],
	});
	await expect(fixture.client.listSessions()).resolves.toMatchObject({
		sessions: [
			{
				sessionId: "archived",
				archived: true,
				archivedAt: "2026-08-29T12:01:00Z",
				createdAt: "2026-08-28T12:00:00Z",
				messageCount: 4,
				projectId: "project",
			},
		],
	});
});

test("sends cancellation and Goose steering with the v1.48 methods", async () => {
	const fixture = fake();
	await fixture.client.cancel("s");
	const steer = await fixture.client.steer("s", "run-1", "stop writing");
	expect(fixture.connection.notifications).toEqual([
		{ method: "session/cancel", params: { sessionId: "s" } },
	]);
	expect(steer).toEqual({ runId: "run-2", messageId: "queued-1" });
});

test("preserves Goose v1.48 image content blocks instead of treating them as empty text", async () => {
	const fixture = fake();
	const updates: GooseUpdate[] = [];
	fixture.client.on((event) => {
		if (event.type === "update") updates.push(event.update);
	});
	await fixture.client.ready();
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: {
			sessionUpdate: "user_message_chunk",
			messageId: "user-1",
			content: { type: "image", data: "AA==", mimeType: "image/png" },
		},
	});
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: {
			sessionUpdate: "agent_message_chunk",
			messageId: "assistant-1",
			content: { type: "text", text: "caption" },
		},
	});
	expect(updates).toEqual([
		expect.objectContaining({
			type: "image",
			role: "user",
			image: { data: "AA==", mimeType: "image/png" },
		}),
		expect.objectContaining({ type: "text", role: "assistant", text: "caption" }),
	]);
});

test("sets provider, model, and thinking through standard config options", async () => {
	const fixture = fake();
	await fixture.client.setProvider("s", "anthropic");
	await fixture.client.setModel("s", "claude-sonnet");
	await fixture.client.setThinking("s", "high");
	expect(
		fixture.connection.calls
			.filter((call) => call.method === "session/set_config_option")
			.map((call) => call.params.configId),
	).toEqual(["provider", "model", "thinking_effort"]);
	expect(
		fixture.connection.calls
			.filter((call) => call.method === "session/set_config_option")
			.map((call) => call.params.value),
	).toEqual(["anthropic", "claude-sonnet", "high"]);
});

test("uses the injected permission callback and responds with its decision", async () => {
	let seen: unknown;
	const fixture = fake((request) => {
		seen = request;
		return { optionId: "allow-second" };
	});
	await fixture.client.ready();
	const response = await fixture.connection.handlers.onPermission(
		{
			sessionId: "s",
			toolCall: { toolCallId: "tool" },
			options: [
				{ optionId: "allow", name: "Allow", kind: "allow_once", _meta: { source: "goose" } },
				{ optionId: "allow-second", name: "Allow here", kind: "allow_once" },
			],
		},
		new AbortController().signal,
	);
	expect(response).toEqual({ outcome: { outcome: "selected", optionId: "allow-second" } });
	expect((seen as { options: { raw: unknown }[] }).options[0]?.raw).toMatchObject({
		_meta: { source: "goose" },
	});
});

test("preserves Goose v1.48 session run updates, provider inventory, and recipe identities", async () => {
	const fixture = fake();
	const events: { update: GooseUpdate }[] = [];
	fixture.client.on((event) => {
		if (event.type === "update") events.push(event);
	});
	await fixture.client.ready();
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: { sessionUpdate: "session_info_update", _meta: { goose: { activeRunId: "run-1" } } },
	});
	fixture.connection.handlers.onSessionUpdate({
		sessionId: "s",
		update: { sessionUpdate: "session_info_update", _meta: { goose: { activeRunId: null } } },
	});
	expect(events.map((event) => event.update)).toMatchObject([
		{ type: "session-info", activeRunId: "run-1" },
		{ type: "session-info", activeRunId: null },
	]);

	fixture.connection.setResponse("_goose/unstable/providers/list", {
		entries: [
			{
				providerId: "openai",
				providerName: "OpenAI",
				configured: true,
				available: false,
				visibleInSetup: true,
				configKeys: [
					{
						name: "OPENAI_API_KEY",
						required: true,
						secret: true,
						oauthFlow: false,
						deviceCodeFlow: false,
						primary: true,
					},
				],
				models: [{ id: "o3", name: "o3", contextLimit: 200000, reasoning: true }],
			},
		],
	});
	fixture.connection.setResponse("_goose/unstable/recipes/list", {
		recipes: [
			{
				id: "daily-review",
				recipe: { version: "1.0.0", title: "Daily review", description: "Review work" },
				file_path: "/recipes/daily-review.yaml",
				last_modified: "2026-08-28T12:00:00Z",
				schedule_cron: "0 9 * * *",
			},
		],
	});
	expect(await fixture.client.listProviders()).toMatchObject([
		{
			id: "openai",
			configured: true,
			available: false,
			visibleInSetup: true,
			configKeys: [{ name: "OPENAI_API_KEY", required: true, secret: true, primary: true }],
			models: [{ id: "o3", reasoning: true, contextLimit: 200000 }],
		},
	]);
	expect(await fixture.client.listRecipes()).toMatchObject([
		{
			id: "daily-review",
			recipe: { title: "Daily review" },
			filePath: "/recipes/daily-review.yaml",
		},
	]);
	fixture.connection.setResponse("_goose/unstable/recipes/scan", { has_security_warnings: true });
	expect(
		await fixture.client.scanRecipe({ title: "Daily review", description: "Review work" }),
	).toEqual({
		hasSecurityWarnings: true,
	});
	fixture.connection.setResponse("_goose/unstable/recipes/save", {
		id: "daily-review",
		file_name: "daily-review.yaml",
		file_path: "/recipes/daily-review.yaml",
	});
	expect(
		await fixture.client.saveRecipe({ title: "Daily review", description: "Review work" }),
	).toEqual({
		id: "daily-review",
		fileName: "daily-review.yaml",
		filePath: "/recipes/daily-review.yaml",
	});
	fixture.connection.setResponse("_goose/unstable/schedules/list", {
		jobs: [
			{
				id: "daily-review",
				source: "recipe",
				cron: "0 9 * * *",
				lastRun: "2026-08-28T09:00:00Z",
				currentlyRunning: false,
				paused: false,
				currentSessionId: "session-1",
				jobStartTime: "2026-08-28T09:00:00Z",
			},
		],
	});
	expect(await fixture.client.listSchedules()).toMatchObject([
		{ id: "daily-review", lastRun: "2026-08-28T09:00:00Z", currentSessionId: "session-1" },
	]);
	fixture.connection.setResponse("_goose/unstable/providers/config/read", {
		fields: [
			{
				key: "OPENAI_API_KEY",
				value: "sk-a...xyz",
				isSet: true,
				isSecret: true,
				required: true,
			},
		],
	});
	expect(await fixture.client.providerConfig("openai")).toEqual([
		{
			key: "OPENAI_API_KEY",
			value: "sk-a...xyz",
			isSet: true,
			isSecret: true,
			required: true,
		},
	]);
	fixture.connection.setResponse("_goose/unstable/schedules/running-job/inspect", {
		running: true,
		sessionId: "session-1",
		jobStartTime: "2026-08-28T09:00:00Z",
		runningDurationSeconds: 42,
	});
	expect(await fixture.client.inspectScheduledJob("daily-review")).toEqual({
		running: true,
		sessionId: "session-1",
		jobStartTime: "2026-08-28T09:00:00Z",
		runningDurationSeconds: 42,
	});
	fixture.connection.setResponse("_goose/unstable/slash-commands/list", {
		availableCommands: [
			{ name: "daily", description: "Run daily review", input: { hint: "topic" } },
		],
	});
	expect(await fixture.client.listSlashCommands({ sessionId: "session-1" })).toMatchObject([
		{ name: "daily", description: "Run daily review", inputHint: "topic" },
	]);
});

test("derives selection from ACP config options and does not time out prompts by default", async () => {
	const fixture = fake();
	await fixture.client.ready();
	fixture.connection.setResponse("session/new", {
		sessionId: "s",
		configOptions: [
			{ id: "provider", currentValue: "anthropic", options: [] },
			{ id: "model", currentValue: "claude-sonnet-4", options: [] },
			{ id: "thinking_effort", currentValue: "high", options: [] },
		],
	});
	const session = await fixture.client.createSession({ cwd: "/workspace" });
	expect(session).toMatchObject({
		providerId: "anthropic",
		modelId: "claude-sonnet-4",
		thinkingEffort: "high",
	});

	fixture.connection.responses.delete("session/prompt");
	fixture.connection.setPendingRequest("session/prompt");
	const slowClient = new GooseClient({
		connectionFactory: { connect: (_handlers) => Promise.resolve(fixture.connection) },
		timeoutMs: 1,
	});
	let settled = false;
	const pending = slowClient.prompt("s", "long running").finally(() => {
		settled = true;
	});
	await Bun.sleep(10);
	expect(settled).toBe(false);
	slowClient.shutdown();
	await expect(pending).rejects.toBeInstanceOf(GooseConnectionLostError);
});

test("dispatches raw Goose custom methods without exposing ACP objects", async () => {
	const fixture = fake();
	await fixture.client.custom("_goose/unstable/recipes/list", {});
	expect(fixture.connection.calls.at(-1)?.method).toBe("_goose/unstable/recipes/list");
});

test("uses Goose v1.48 snake_case recipe schedule and slash command fields", async () => {
	const fixture = fake();
	await fixture.client.setRecipeSchedule("daily", "0 9 * * *");
	await fixture.client.setRecipeSlashCommand("daily", "/daily");
	expect(fixture.connection.calls.slice(-2)).toEqual([
		{
			method: "_goose/unstable/recipes/schedule",
			params: { id: "daily", cron_schedule: "0 9 * * *" },
		},
		{
			method: "_goose/unstable/recipes/slash-command",
			params: { id: "daily", slash_command: "/daily" },
		},
	]);
});

test("fails a pending request when its transport disconnects", async () => {
	const fixture = fake();
	await fixture.client.ready();
	fixture.connection.setPendingRequest();
	const pending = fixture.client.listSessions();
	fixture.connection.disconnect();
	await expect(pending).rejects.toBeInstanceOf(GooseConnectionLostError);
});
