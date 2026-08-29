import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionLifecycleChangedPayload } from "@gooseberry/contracts";
import {
	GooseClient,
	type GooseConnection,
	type GooseConnectionFactory,
} from "@gooseberry/goose-client";
import { setMountedProjectRootsForTesting } from "../path-admission";
import {
	forgetProjectSession,
	loadProjectSessionRecords,
	recordProjectSession,
	setDataDirForTests,
} from "../persistence";
import {
	abortSession,
	addGooseExtension,
	addSessionExtension,
	archiveSession,
	askSessionQuestion,
	cancelProviderLogin,
	createSession,
	disposeAllSessions,
	editSessionQueue,
	forkSession,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	gooseRecipes,
	gooseSchedules,
	hasSession,
	isSessionStreaming,
	listGooseExtensions,
	listSessionExtensions,
	listSessions,
	listSessionTools,
	pendingPermissionSnapshot,
	promptSession,
	providerLoginSnapshot,
	queueSessionMessage,
	removeSessionExtension,
	removeSessionQueue,
	renameSession,
	replyProviderLogin,
	requestPermission,
	resolvePermission,
	resolveSessionQuestion,
	searchSessionHistory,
	setGooseClient,
	setGooseExtensionEnabled,
	setObjectiveMcpUrl,
	setPermissionPublisher,
	setPermissionTimeoutForTests,
	setProviderLoginPublisher,
	setProviderLoginTimeoutForTests,
	setSessionLifecyclePublisher,
	setSessionModel,
	setSessionPublisher,
	setSessionThinkingLevel,
	setSessionToolPermission,
	startProviderLogin,
	steerSession,
	unarchiveSession,
} from "./agent-session-manager";

class FakeConnection implements GooseConnection {
	readonly calls: { method: string; params: Record<string, unknown> }[] = [];
	readonly notifications: { method: string; params: Record<string, unknown> }[] = [];
	#resolveClosed!: () => void;
	readonly closed = new Promise<void>((resolve) => {
		this.#resolveClosed = resolve;
	});
	promptGate: Promise<void> | undefined;
	authenticateGate: Promise<void> | undefined;
	saveGate: Promise<void> | undefined;
	loadGate: Promise<void> | undefined;
	loadUpdates: ((sessionId: string) => void) | undefined;
	loadFailures = 0;
	sessionNewIds: string[] = [];
	sessionArchived = false;
	sessionHasMessages = true;
	sessionTitle = "Chat";
	archiveError: Error | undefined;
	archiveGate: Promise<void> | undefined;
	forkGate: Promise<void> | undefined;
	forkSessionId = "goose-fork";
	sessionInfoError: unknown;
	administrationMutationGate: Promise<void> | undefined;
	administrationMutationError: Error | undefined;
	configuredExtensions: {
		extension: Record<string, unknown>;
		enabled: boolean;
		configKey: string;
	}[] = [
		{
			extension: {
				type: "mcp",
				server: {
					name: "private",
					url: "https://secret.example",
					headers: { token: "secret" },
				},
			},
			enabled: true,
			configKey: "private-key",
		},
	];
	availableExtensions: Record<string, unknown>[] = [
		{ type: "builtin", name: "developer", command: "do-not-expose" },
	];
	sessionExtensions: Record<string, unknown>[] = [
		{ type: "mcp", server: { name: "private", url: "https://secret.example" } },
	];
	toolPermission = "ask_before";
	constructor(readonly handlers: Parameters<GooseConnectionFactory["connect"]>[0]) {}
	async request(method: string, params: Record<string, unknown>): Promise<unknown> {
		this.calls.push({
			method,
			params: JSON.parse(JSON.stringify(params)) as Record<string, unknown>,
		});
		if (method === "initialize") return {};
		if (method === "session/new")
			return {
				sessionId: this.sessionNewIds.shift() ?? "goose-1",
				configOptions: [
					{ id: "provider", currentValue: "openai", options: [] },
					{ id: "model", currentValue: "gpt", options: [] },
				],
			};
		if (method === "session/load") {
			await this.loadGate;
			if (this.loadFailures > 0) {
				this.loadFailures--;
				throw new Error("temporary load failure");
			}
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
		if (method === "session/fork") {
			await this.forkGate;
			return {
				sessionId: this.forkSessionId,
				configOptions: [
					{ id: "provider", currentValue: "openai", options: [] },
					{ id: "model", currentValue: "gpt", options: [] },
				],
			};
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
		if (method === "_goose/unstable/session/rename") {
			this.sessionTitle = params.title as string;
			return {};
		}
		if (method === "_goose/unstable/session/archive") {
			if (this.archiveError) throw this.archiveError;
			await this.archiveGate;
			this.sessionArchived = true;
			return {};
		}
		if (method === "_goose/unstable/session/unarchive") {
			this.sessionArchived = false;
			return {};
		}
		if (method === "_goose/unstable/session/info") {
			if (this.sessionInfoError) throw this.sessionInfoError;
			return {
				session: {
					sessionId: params.sessionId,
					title: this.sessionTitle,
					updatedAt: "2026-01-02T03:04:05Z",
					_meta: {
						messageCount: this.sessionHasMessages ? 1 : 0,
						...(this.sessionArchived ? { archivedAt: "2026-01-02T03:05:00Z" } : {}),
					},
				},
			};
		}
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
		if (method === "_goose/unstable/providers/list")
			return {
				entries: [
					{
						providerId: "openai",
						providerName: "OpenAI",
						configured: false,
						available: true,
						visibleInSetup: true,
						configKeys: [
							{
								name: "OPENAI_API_KEY",
								required: true,
								secret: true,
								oauthFlow: false,
								primary: true,
							},
						],
						models: [],
					},
					{
						providerId: "github_copilot",
						providerName: "GitHub Copilot",
						configured: false,
						available: true,
						visibleInSetup: true,
						configKeys: [
							{
								name: "GITHUB_COPILOT_TOKEN",
								required: true,
								secret: true,
								oauthFlow: true,
								deviceCodeFlow: true,
								primary: true,
							},
						],
						models: [],
					},
				],
			};
		if (method === "_goose/unstable/providers/config/read")
			return {
				fields: [
					{
						key: "OPENAI_API_KEY",
						isSet: false,
						isSecret: true,
						required: true,
					},
				],
			};
		if (method === "_goose/unstable/providers/config/save") {
			await this.saveGate;
			return { status: {}, refresh: {} };
		}
		if (method === "_goose/unstable/config/extensions/list")
			return { extensions: this.configuredExtensions, warnings: ["secret warning"] };
		if (method === "_goose/unstable/extensions/available")
			return { extensions: this.availableExtensions };
		if (method === "_goose/unstable/config/extensions/add") {
			await this.administrationMutationGate;
			if (this.administrationMutationError) throw this.administrationMutationError;
			const extension = params.extension as Record<string, unknown>;
			this.configuredExtensions.push({
				extension,
				enabled: params.enabled === true,
				configKey: `key-${extensionName(extension)}`,
			});
			return {};
		}
		if (method === "_goose/unstable/config/extensions/set-enabled") {
			await this.administrationMutationGate;
			if (this.administrationMutationError) throw this.administrationMutationError;
			const configured = this.configuredExtensions.find(
				(extension) => extension.configKey === params.configKey,
			);
			if (configured) configured.enabled = params.enabled === true;
			return {};
		}
		if (method === "_goose/unstable/config/extensions/remove") {
			await this.administrationMutationGate;
			if (this.administrationMutationError) throw this.administrationMutationError;
			this.configuredExtensions = this.configuredExtensions.filter(
				(extension) => extension.configKey !== params.configKey,
			);
			return {};
		}
		if (method === "_goose/unstable/session/extensions/list")
			return { extensions: this.sessionExtensions };
		if (method === "_goose/unstable/session/extensions/add") {
			await this.administrationMutationGate;
			if (this.administrationMutationError) throw this.administrationMutationError;
			this.sessionExtensions.push(params.extension as Record<string, unknown>);
			return {};
		}
		if (method === "_goose/unstable/session/extensions/remove") {
			await this.administrationMutationGate;
			if (this.administrationMutationError) throw this.administrationMutationError;
			this.sessionExtensions = this.sessionExtensions.filter(
				(extension) => extensionName(extension) !== params.name,
			);
			return {};
		}
		if (method === "_goose/unstable/tools/list")
			return {
				tools: [
					{
						name: "developer__shell",
						description: "Run a command",
						parameters: ["command"],
						permission: this.toolPermission,
						inputSchema: { secret: "must not reach browser" },
					},
				],
			};
		if (method === "_goose/unstable/tools/permissions/set") {
			await this.administrationMutationGate;
			if (this.administrationMutationError) throw this.administrationMutationError;
			const permissions = params.toolPermissions as { permission?: unknown }[];
			this.toolPermission = permissions[0]?.permission as string;
			return {};
		}
		if (method === "_goose/unstable/providers/config/authenticate") {
			await this.authenticateGate;
			this.handlers.onGooseNotification("_goose/unstable/providers/authentication/device-code", {
				providerId: params.providerId,
				userCode: "ABCD-EFGH",
				verificationUri: "https://github.com/login/device",
				expiresIn: 900,
			});
			return { status: {}, refresh: {} };
		}
		if (method === "_goose/unstable/slash-commands/list")
			return {
				availableCommands: [{ name: "review", description: "Review the current work" }],
			};
		if (method === "session/list")
			return {
				sessions: this.sessionHasMessages
					? [
							{
								sessionId: "goose-1",
								title: this.sessionTitle,
								updatedAt: "2026-01-02T03:04:05Z",
								_meta: {
									messageCount: 1,
									...(this.sessionArchived ? { archivedAt: "2026-01-02T03:05:00Z" } : {}),
								},
							},
						]
					: [],
			};
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

function extensionName(extension: Record<string, unknown>): string {
	if (extension.type === "mcp") {
		const server = extension.server;
		if (server && typeof server === "object" && typeof Reflect.get(server, "name") === "string") {
			return Reflect.get(server, "name") as string;
		}
	}
	return typeof extension.name === "string" ? extension.name : "unknown";
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
	setProviderLoginTimeoutForTests(undefined);
	setSessionLifecyclePublisher(() => {});
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

test("extension and tool administration re-queries sanitized Goose state and rejects unsafe mutations", async () => {
	const f = fixture();
	const catalog = await listGooseExtensions();
	expect(catalog).toEqual({
		configured: [{ name: "private", type: "mcp", enabled: true, configKey: "private-key" }],
		available: [{ name: "developer", type: "builtin" }],
		warningCount: 1,
	});
	expect(JSON.stringify(catalog)).not.toContain("secret");
	expect(JSON.stringify(catalog)).not.toContain("secret warning");
	const enabledCatalog = await setGooseExtensionEnabled("private-key", false);
	expect(enabledCatalog.configured).toEqual([
		{ name: "private", type: "mcp", enabled: false, configKey: "private-key" },
	]);
	expect(f.connection.calls.at(-3)).toEqual({
		method: "_goose/unstable/config/extensions/set-enabled",
		params: { configKey: "private-key", enabled: false },
	});
	await expect(setGooseExtensionEnabled("missing-key", true)).rejects.toThrow(
		"Unknown configured extension key",
	);
	const addedCatalog = await addGooseExtension("developer", true);
	expect(addedCatalog.configured).toEqual(
		expect.arrayContaining([
			{ name: "developer", type: "builtin", enabled: true, configKey: "key-developer" },
		]),
	);
	expect(f.connection.calls).toContainEqual({
		method: "_goose/unstable/config/extensions/add",
		params: {
			extension: { type: "builtin", name: "developer", command: "do-not-expose" },
			enabled: true,
		},
	});
	await expect(addGooseExtension("developer", true)).rejects.toThrow("already configured");
	await expect(addGooseExtension("missing", true)).rejects.toThrow("Unknown available extension");

	const created = await createSession({ projectId: "project", cwd: f.directory });
	await expect(addSessionExtension(created.sessionId, "missing")).rejects.toThrow(
		"Unknown extension",
	);
	await expect(
		setSessionToolPermission(created.sessionId, "missing", "ask_before"),
	).rejects.toThrow("Unknown tool");
	await expect(
		setSessionToolPermission(created.sessionId, "developer__shell", "invalid"),
	).rejects.toThrow("Unknown tool permission");
	const addedSessionExtensions = await addSessionExtension(created.sessionId, "developer");
	expect(addedSessionExtensions).toEqual(
		expect.arrayContaining([{ name: "developer", type: "builtin" }]),
	);
	expect(f.connection.calls).toContainEqual({
		method: "_goose/unstable/session/extensions/add",
		params: {
			sessionId: created.sessionId,
			extension: { type: "builtin", name: "developer", command: "do-not-expose" },
		},
	});
	const removedSessionExtensions = await removeSessionExtension(created.sessionId, "developer");
	expect(removedSessionExtensions).toEqual([{ name: "private", type: "mcp" }]);
	expect(f.connection.calls).toContainEqual({
		method: "_goose/unstable/session/extensions/remove",
		params: { sessionId: created.sessionId, name: "developer" },
	});
	const refreshedTools = await setSessionToolPermission(
		created.sessionId,
		"developer__shell",
		"always_allow",
	);
	expect(refreshedTools).toEqual([
		{
			name: "developer__shell",
			description: "Run a command",
			parameters: ["command"],
			permission: "always_allow",
		},
	]);
	expect(f.connection.calls).toContainEqual({
		method: "_goose/unstable/tools/permissions/set",
		params: { toolPermissions: [{ toolName: "developer__shell", permission: "always_allow" }] },
	});
	const tools = await listSessionTools(created.sessionId);
	expect(tools).toEqual([
		{
			name: "developer__shell",
			description: "Run a command",
			parameters: ["command"],
			permission: "always_allow",
		},
	]);
	expect(JSON.stringify(tools)).not.toContain("inputSchema");
	const sessionExtensions = await listSessionExtensions(created.sessionId);
	expect(sessionExtensions).toEqual([{ name: "private", type: "mcp" }]);
	expect(JSON.stringify(sessionExtensions)).not.toContain("secret");
	f.connection.promptGate = new Promise(() => {});
	await promptSession(created.sessionId, "hold open");
	await expect(addSessionExtension(created.sessionId, "developer")).rejects.toThrow("running chat");
	await expect(
		setSessionToolPermission(created.sessionId, "developer__shell", "ask_before"),
	).rejects.toThrow("changing tool permissions");
});

test("extension administration mutations are exclusive with chat activity and each other", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	let releaseSessionMutation: (() => void) | undefined;
	f.connection.administrationMutationGate = new Promise<void>((resolve) => {
		releaseSessionMutation = resolve;
	});
	const sessionMutation = addSessionExtension(created.sessionId, "developer");
	await expect(promptSession(created.sessionId, "must wait")).rejects.toThrow(
		"extension or permission update",
	);
	await expect(
		setSessionToolPermission(created.sessionId, "developer__shell", "ask_before"),
	).rejects.toThrow("finish loading or updating");
	releaseSessionMutation?.();
	await sessionMutation;

	let releaseGlobalMutation: (() => void) | undefined;
	f.connection.administrationMutationGate = new Promise<void>((resolve) => {
		releaseGlobalMutation = resolve;
	});
	const globalMutation = setGooseExtensionEnabled("private-key", false);
	await expect(addGooseExtension("developer", true)).rejects.toThrow("Goose extension update");
	releaseGlobalMutation?.();
	await globalMutation;
	rmSync(f.directory, { recursive: true, force: true });
});

test("extension administration failures retain their cause without exposing it in the browser message", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	f.connection.administrationMutationError = new Error(
		"command --secret https://private.example Authorization=token ENV_SECRET=value",
	);
	const failure = await addSessionExtension(created.sessionId, "developer").then(
		() => null,
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(Error);
	if (!(failure instanceof Error)) throw new Error("Expected administration failure");
	expect(failure.message).toBe("Goose couldn't add the chat extension");
	expect(failure.message).not.toContain("private.example");
	expect(failure.message).not.toContain("ENV_SECRET");
	expect((failure.cause as Error).message).toContain("private.example");
	rmSync(f.directory, { recursive: true, force: true });
});

test("global tool permission updates for the same tool are exclusive across chats", async () => {
	const f = fixture();
	await f.client.ready();
	f.connection.sessionNewIds = ["goose-1", "goose-2"];
	const first = await createSession({ projectId: "project", cwd: f.directory });
	const second = await createSession({ projectId: "project", cwd: f.directory });
	let releasePermission: (() => void) | undefined;
	f.connection.administrationMutationGate = new Promise<void>((resolve) => {
		releasePermission = resolve;
	});
	const firstUpdate = setSessionToolPermission(first.sessionId, "developer__shell", "always_allow");
	await expect(
		setSessionToolPermission(second.sessionId, "developer__shell", "never_allow"),
	).rejects.toThrow("Goose tool permission update");
	releasePermission?.();
	await firstUpdate;
	rmSync(f.directory, { recursive: true, force: true });
});

test("controller queues follow-ups across browser hydration and drains them after settlement", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	let releasePrompt: (() => void) | undefined;
	f.connection.promptGate = new Promise<void>((resolve) => {
		releasePrompt = resolve;
	});
	const queueEvents: { steering: readonly string[]; followUp: readonly string[] }[] = [];
	setSessionPublisher(({ event }) => {
		if (event.type === "queue_update") queueEvents.push(event);
	});
	await promptSession(created.sessionId, "working");
	await queueSessionMessage(created.sessionId, "first follow-up");
	await queueSessionMessage(created.sessionId, "second follow-up");
	await editSessionQueue(created.sessionId, "followUp", 1, "revised follow-up");

	expect(
		(await getSessionMessages(created.sessionId, "project", f.directory)).summary.queue,
	).toEqual({
		steering: [],
		followUp: ["first follow-up", "revised follow-up"],
	});
	await removeSessionQueue(created.sessionId, "followUp", 0);
	expect(queueEvents.at(-1)?.followUp).toEqual(["revised follow-up"]);

	releasePrompt?.();
	for (let attempt = 0; attempt < 20; attempt++) {
		if (f.connection.calls.filter((call) => call.method === "session/prompt").length >= 2) break;
		await Bun.sleep(5);
	}
	expect(f.connection.calls.filter((call) => call.method === "session/prompt")).toHaveLength(2);
	expect(
		(await getSessionMessages(created.sessionId, "project", f.directory)).summary.queue,
	).toEqual({
		steering: [],
		followUp: [],
	});
});

test("a failed active prompt retains queued follow-ups", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	let rejectPrompt: ((error: Error) => void) | undefined;
	f.connection.promptGate = new Promise<void>((_resolve, reject) => {
		rejectPrompt = reject;
	});
	await promptSession(created.sessionId, "working");
	await queueSessionMessage(created.sessionId, "retry later");
	rejectPrompt?.(new Error("provider unavailable"));
	await Bun.sleep(1);
	expect((await listSessions("project"))[0]?.queue?.followUp).toEqual(["retry later"]);
	expect(f.connection.calls.filter((call) => call.method === "session/prompt")).toHaveLength(1);
});

test("usage totals accumulate while unreported fields remain distinguishable", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	await promptSession(created.sessionId, "one");
	await Bun.sleep(1);
	await promptSession(created.sessionId, "two");
	await Bun.sleep(1);
	expect(getSessionStats(created.sessionId)).toMatchObject({
		tokens: { input: 4, output: 6, cacheRead: 0, cacheWrite: 0, total: 10 },
		cost: 0,
		reported: { input: true, output: true, total: true },
	});
	expect(getSessionStats(created.sessionId).reported?.cost).toBeUndefined();
	expect(getSessionStats(created.sessionId).reported?.cacheRead).toBeUndefined();
});

test("supporting questions pause an MCP tool until the browser replies", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	const args = {
		questions: [
			{
				question: "Which path should I take?",
				header: "Approach",
				options: [{ label: "Focused", description: "Keep the change small" }],
			},
		],
	};
	f.connection.handlers.onSessionUpdate({
		sessionId: created.sessionId,
		update: {
			sessionUpdate: "tool_call",
			toolCallId: "question-1",
			title: "Ask",
			kind: "mcp",
			_meta: { goose: { toolCall: { toolName: "gooseberry-objectives__ask_user_question" } } },
			rawInput: args,
		},
	});
	const pending = askSessionQuestion(created.sessionId, args);
	const answer = {
		answers: [
			{
				questionIndex: 0,
				question: "Which path should I take?",
				kind: "option" as const,
				answer: "Focused",
			},
		],
		cancelled: false,
	};
	resolveSessionQuestion(created.sessionId, "question-1", answer);
	expect(await pending).toEqual(answer);
	const secondPending = askSessionQuestion(created.sessionId, args);
	await Bun.sleep(1);
	f.connection.handlers.onSessionUpdate({
		sessionId: created.sessionId,
		update: {
			sessionUpdate: "tool_call",
			toolCallId: "question-2",
			title: "Ask again",
			kind: "mcp",
			_meta: { goose: { toolCall: { toolName: "gooseberry-objectives__ask_user_question" } } },
			rawInput: args,
		},
	});
	await Bun.sleep(30);
	resolveSessionQuestion(created.sessionId, "question-2", answer);
	expect(await secondPending).toEqual(answer);
	const messages = (await getSessionMessages(created.sessionId, "project", f.directory)).messages;
	expect(messages.at(-1)).toMatchObject({
		role: "assistant",
		content: expect.arrayContaining([
			expect.objectContaining({ type: "toolCall", id: "question-2", name: "ask_user_question" }),
		]),
	});
});

test("Goose session rename and reversible archive stay project-associated", async () => {
	const f = fixture();
	const lifecycle: SessionLifecycleChangedPayload[] = [];
	setSessionLifecyclePublisher((payload) => lifecycle.push(payload));
	const created = await createSession({ projectId: "project", cwd: f.directory });
	await renameSession(created.sessionId, "project", f.directory, "  Focused work  ");
	expect((await listSessions("project"))[0]).toMatchObject({
		title: "Focused work",
		archived: false,
	});
	await archiveSession(created.sessionId, "project", f.directory);
	f.connection.sessionHasMessages = false;
	expect(hasSession(created.sessionId)).toBe(false);
	expect(loadProjectSessionRecords()).toEqual([
		{ projectId: "project", sessionId: created.sessionId, cwd: f.directory },
	]);
	expect(await listSessions("project")).toEqual([]);
	expect(await listSessions("project", true)).toMatchObject([
		{
			sessionId: created.sessionId,
			title: "Focused work",
			archived: true,
			live: false,
			messageCount: 0,
		},
	]);
	expect(await listSessions("project", "all")).toMatchObject([
		{ sessionId: created.sessionId, archived: true },
	]);
	const loadsBeforeRestore = f.connection.calls.filter(
		(call) => call.method === "session/load",
	).length;
	await unarchiveSession(created.sessionId, "project", f.directory);
	f.connection.sessionHasMessages = true;
	const loadsAfterRestore = f.connection.calls.filter(
		(call) => call.method === "session/load",
	).length;
	expect(loadsAfterRestore).toBe(loadsBeforeRestore);
	expect(await listSessions("project")).toMatchObject([
		{ sessionId: created.sessionId, title: "Focused work", archived: false },
	]);
	expect(lifecycle).toEqual([
		{
			projectId: "project",
			sessionId: created.sessionId,
			operation: "renamed",
			title: "Focused work",
		},
		{ projectId: "project", sessionId: created.sessionId, operation: "archived" },
		{ projectId: "project", sessionId: created.sessionId, operation: "unarchived" },
	]);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("Goose forks recorded settled sessions, records lineage, and installs objectives on child load", async () => {
	const f = fixture();
	setObjectiveMcpUrl("http://127.0.0.1:7312/mcp/objective");
	const source = await createSession({ projectId: "project", cwd: f.directory });
	const fork = await forkSession(source.sessionId, "project", f.directory);
	expect(fork).toMatchObject({
		sessionId: "goose-fork",
		projectId: "project",
		cwd: f.directory,
		parentSessionId: source.sessionId,
		model: { provider: "openai", id: "gpt" },
	});
	expect(loadProjectSessionRecords()).toContainEqual({
		projectId: "project",
		sessionId: "goose-fork",
		cwd: f.directory,
		parentSessionId: source.sessionId,
	});
	const forkCall = f.connection.calls.at(-1);
	const sourceCreate = f.connection.calls.find((call) => call.method === "session/new");
	const forkMcpServers = JSON.parse(JSON.stringify(forkCall?.params.mcpServers));
	const sourceMcpServers = JSON.parse(JSON.stringify(sourceCreate?.params.mcpServers));
	const authorizationToken = (servers: unknown) => {
		if (!Array.isArray(servers)) return undefined;
		const first = servers[0];
		if (!first || typeof first !== "object" || Array.isArray(first)) return undefined;
		const headers = Reflect.get(first, "headers");
		if (!Array.isArray(headers)) return undefined;
		const authorization = headers.find(
			(header) =>
				header && typeof header === "object" && Reflect.get(header, "name") === "Authorization",
		);
		const value = authorization && Reflect.get(authorization, "value");
		return typeof value === "string" ? value : undefined;
	};
	const sourceToken = authorizationToken(sourceMcpServers);
	const childToken = authorizationToken(forkMcpServers);
	expect(forkCall).toMatchObject({
		method: "session/fork",
		params: {
			sessionId: source.sessionId,
			cwd: f.directory,
			mcpServers: [
				expect.objectContaining({
					name: "gooseberry-objectives",
					headers: [expect.objectContaining({ name: "Authorization", value: expect.any(String) })],
				}),
			],
		},
	});
	expect(childToken).toMatch(/^Bearer /);
	expect(childToken).not.toBe(sourceToken);
	f.connection.forkSessionId = "goose-fork-2";
	const chained = await forkSession(fork.sessionId, "project", f.directory);
	expect(chained).toMatchObject({
		sessionId: "goose-fork-2",
		parentSessionId: fork.sessionId,
	});
	expect(loadProjectSessionRecords()).toContainEqual({
		projectId: "project",
		sessionId: chained.sessionId,
		cwd: f.directory,
		parentSessionId: fork.sessionId,
	});
	await getSessionMessages(fork.sessionId, "project", f.directory);
	const childLoad = f.connection.calls.at(-1);
	const childLoadMcpServers = JSON.parse(JSON.stringify(childLoad?.params.mcpServers));
	expect(childLoad).toMatchObject({
		method: "session/load",
		params: {
			sessionId: fork.sessionId,
			cwd: f.directory,
			mcpServers: [expect.objectContaining({ name: "gooseberry-objectives" })],
		},
	});
	expect(childLoadMcpServers).toEqual(forkMcpServers);
	disposeAllSessions();
	setObjectiveMcpUrl(undefined);
	rmSync(f.directory, { recursive: true, force: true });
});

test("fork rejects Goose child identifiers that collide with recorded or live sessions", async () => {
	const f = fixture();
	const source = await createSession({ projectId: "project", cwd: f.directory });
	recordProjectSession({
		projectId: "project",
		sessionId: "recorded-child",
		cwd: f.directory,
		parentSessionId: source.sessionId,
	});
	f.connection.forkSessionId = "recorded-child";
	await expect(forkSession(source.sessionId, "project", f.directory)).rejects.toThrow(
		"existing session identifier",
	);
	expect(hasSession("recorded-child")).toBe(false);

	f.connection.forkSessionId = "live-child";
	const live = await forkSession(source.sessionId, "project", f.directory);
	forgetProjectSession("project", live.sessionId);
	await expect(forkSession(source.sessionId, "project", f.directory)).rejects.toThrow(
		"existing session identifier",
	);
	expect(hasSession(live.sessionId)).toBe(true);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("fork remains blocked by a known run after the ACP connection disconnects", async () => {
	const f = fixture();
	const source = await createSession({ projectId: "project", cwd: f.directory });
	f.connection.promptGate = new Promise<void>(() => {});
	await promptSession(source.sessionId, "keep working");
	f.connection.handlers.onSessionUpdate({
		sessionId: source.sessionId,
		update: {
			sessionUpdate: "session_info_update",
			_meta: { goose: { activeRunId: "run-before-disconnect" } },
		},
	});
	f.connection.disconnect();
	await Promise.resolve();
	expect(isSessionStreaming(source.sessionId)).toBe(false);
	await expect(forkSession(source.sessionId, "project", f.directory)).rejects.toThrow(
		"Stop the running chat",
	);
	expect(f.connection.calls.filter((call) => call.method === "session/fork")).toEqual([]);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("fork refuses a streaming source and concurrent fork snapshots", async () => {
	const f = fixture();
	const source = await createSession({ projectId: "project", cwd: f.directory });
	let releasePrompt = () => {};
	f.connection.promptGate = new Promise<void>((resolve) => {
		releasePrompt = resolve;
	});
	await promptSession(source.sessionId, "keep working");
	await expect(forkSession(source.sessionId, "project", f.directory)).rejects.toThrow(
		"Stop the running chat",
	);
	releasePrompt();
	await Bun.sleep(1);
	let releaseFork = () => {};
	f.connection.forkGate = new Promise<void>((resolve) => {
		releaseFork = resolve;
	});
	const first = forkSession(source.sessionId, "project", f.directory);
	while (!f.connection.calls.some((call) => call.method === "session/fork")) await Bun.sleep(0);
	await expect(forkSession(source.sessionId, "project", f.directory)).rejects.toThrow(
		"finish loading or updating before forking",
	);
	await expect(archiveSession(source.sessionId, "project", f.directory)).rejects.toThrow(
		"finish loading or updating",
	);
	releaseFork();
	await first;
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("session info fallback omits only confirmed missing records", async () => {
	const f = fixture();
	await createSession({ projectId: "project", cwd: f.directory });
	disposeAllSessions();
	f.connection.sessionHasMessages = false;
	f.connection.sessionInfoError = new Error("session info timed out");
	await expect(listSessions("project")).rejects.toThrow("session info timed out");
	f.connection.sessionInfoError = Object.assign(new Error("missing"), { code: -32002 });
	await expect(listSessions("project")).resolves.toEqual([]);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("confirmed missing session info excludes and clears a stale live projection", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	f.connection.sessionHasMessages = false;
	f.connection.sessionInfoError = Object.assign(new Error("missing"), { code: -32002 });
	await expect(listSessions("project", "all")).resolves.toEqual([]);
	expect(hasSession(created.sessionId)).toBe(false);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("session info fallback has an explicit total request budget", async () => {
	const f = fixture();
	await createSession({ projectId: "project", cwd: f.directory });
	for (let index = 0; index <= 200; index++) {
		recordProjectSession({ projectId: "project", sessionId: `missing-${index}`, cwd: f.directory });
	}
	await expect(listSessions("project")).rejects.toThrow("more than 200 per-session lookups");
	expect(
		f.connection.calls.filter((call) => call.method === "_goose/unstable/session/info"),
	).toEqual([]);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("session lifecycle validation and ACP failures preserve the live projection", async () => {
	const f = fixture();
	const lifecycle: string[] = [];
	setSessionLifecyclePublisher((payload) => lifecycle.push(payload.operation));
	const created = await createSession({ projectId: "project", cwd: f.directory });
	const lifecycleCalls = () =>
		f.connection.calls.filter((call) => call.method.startsWith("_goose/unstable/session/"));
	await expect(renameSession(created.sessionId, "project", f.directory, "   ")).rejects.toThrow(
		"cannot be empty",
	);
	expect(lifecycleCalls()).toEqual([]);
	f.connection.archiveError = new Error("archive unavailable");
	await expect(archiveSession(created.sessionId, "project", f.directory)).rejects.toThrow(
		"archive unavailable",
	);
	expect(hasSession(created.sessionId)).toBe(true);
	expect(lifecycle).toEqual([]);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("a streaming Goose session must settle before it can be archived", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	let releasePrompt = () => {};
	f.connection.promptGate = new Promise<void>((resolve) => {
		releasePrompt = resolve;
	});
	const prompting = promptSession(created.sessionId, "keep working");
	while (!isSessionStreaming(created.sessionId)) await Bun.sleep(0);
	await expect(archiveSession(created.sessionId, "project", f.directory)).rejects.toThrow(
		"Stop the running chat",
	);
	releasePrompt();
	await prompting;
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("archive cannot race a session attachment", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	disposeAllSessions();
	let releaseLoad = () => {};
	f.connection.loadGate = new Promise<void>((resolve) => {
		releaseLoad = resolve;
	});
	const loading = getSessionMessages(created.sessionId, "project", f.directory);
	while (!f.connection.calls.some((call) => call.method === "session/load")) await Bun.sleep(0);
	await expect(archiveSession(created.sessionId, "project", f.directory)).rejects.toThrow(
		"finish loading or updating",
	);
	releaseLoad();
	await loading;
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("an in-flight archive rejects new session work before Goose can load or prompt", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	let releaseArchive = () => {};
	f.connection.archiveGate = new Promise<void>((resolve) => {
		releaseArchive = resolve;
	});
	const archiving = archiveSession(created.sessionId, "project", f.directory);
	while (!f.connection.calls.some((call) => call.method === "_goose/unstable/session/archive")) {
		await Bun.sleep(0);
	}
	await expect(promptSession(created.sessionId, "too late")).rejects.toThrow("archive operation");
	releaseArchive();
	await archiving;
	expect(f.connection.calls.filter((call) => call.method === "session/prompt")).toEqual([]);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
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

test("provider API-key and OAuth flows remain owned by Goose and publish bounded UI frames", async () => {
	const f = fixture();
	const pushes: { providerId: string; frame: { kind: string } }[] = [];
	setProviderLoginPublisher((_clientKey, payload) => pushes.push(payload));

	const apiKey = await startProviderLogin("browser", "openai", "api_key");
	expect(apiKey.frame).toMatchObject({ kind: "prompt", secret: true });
	await replyProviderLogin("browser", apiKey.loginId, "  secret-value  ");
	expect(pushes.map((push) => push.frame.kind)).toEqual(["progress", "success"]);
	expect(f.connection.calls.at(-1)).toMatchObject({
		method: "_goose/unstable/providers/config/save",
		params: {
			providerId: "openai",
			fields: [{ key: "OPENAI_API_KEY", value: "  secret-value  " }],
		},
	});

	pushes.length = 0;
	const oauth = await startProviderLogin("browser", "github_copilot", "oauth");
	expect(oauth.frame.kind).toBe("progress");
	await Bun.sleep(10);
	expect(pushes.map((push) => push.frame.kind)).toEqual(["deviceCode", "success"]);
	expect(providerLoginSnapshot("browser")?.loginId).toBe(oauth.loginId);
	cancelProviderLogin("browser", oauth.loginId);
	expect(providerLoginSnapshot("browser")).toBeUndefined();
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("provider login serializes a provider while allowing a different provider", async () => {
	const f = fixture();
	const oauth = await startProviderLogin("browser-a", "github_copilot", "oauth");
	await expect(startProviderLogin("browser-b", "github_copilot", "oauth")).rejects.toThrow(
		"already in progress for this provider",
	);
	const apiKey = await startProviderLogin("browser-b", "openai", "api_key");
	cancelProviderLogin("browser-b", apiKey.loginId);
	await Bun.sleep(10);
	cancelProviderLogin("browser-a", oauth.loginId);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("cancelled OAuth retains provider ownership until the ACP request settles", async () => {
	const f = fixture();
	await f.client.ready();
	let releaseAuthentication = () => {};
	f.connection.authenticateGate = new Promise<void>((resolve) => {
		releaseAuthentication = resolve;
	});
	const pushes: { clientKey: string; kind: string }[] = [];
	setProviderLoginPublisher((clientKey, payload) =>
		pushes.push({ clientKey, kind: payload.frame.kind }),
	);
	const first = await startProviderLogin("browser-a", "github_copilot", "oauth");
	while (
		!f.connection.calls.some(
			(call) => call.method === "_goose/unstable/providers/config/authenticate",
		)
	) {
		await Bun.sleep(1);
	}
	cancelProviderLogin("browser-a", first.loginId);
	await expect(startProviderLogin("browser-b", "github_copilot", "oauth")).rejects.toThrow(
		"already in progress for this provider",
	);
	releaseAuthentication();
	await Bun.sleep(10);
	expect(pushes).toEqual([]);
	const second = await startProviderLogin("browser-b", "github_copilot", "oauth");
	await Bun.sleep(10);
	cancelProviderLogin("browser-b", second.loginId);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("expired provider requests reset a stuck ACP transport before allowing overlap", async () => {
	setProviderLoginTimeoutForTests(30);
	const f = fixture();
	await f.client.ready();
	const stuckConnection = f.connection;
	stuckConnection.authenticateGate = new Promise<void>(() => {});
	await startProviderLogin("browser-a", "github_copilot", "oauth");
	while (
		!stuckConnection.calls.some(
			(call) => call.method === "_goose/unstable/providers/config/authenticate",
		)
	) {
		await Bun.sleep(1);
	}
	await Bun.sleep(40);
	const replacement = await startProviderLogin("browser-b", "github_copilot", "oauth");
	await Bun.sleep(10);
	cancelProviderLogin("browser-b", replacement.loginId);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("API-key save stays serialized until transport settlement or bounded reset", async () => {
	setProviderLoginTimeoutForTests(30);
	const f = fixture();
	await f.client.ready();
	const stuckConnection = f.connection;
	stuckConnection.saveGate = new Promise<void>(() => {});
	const first = await startProviderLogin("browser-a", "openai", "api_key");
	const saving = replyProviderLogin("browser-a", first.loginId, "secret");
	while (
		!stuckConnection.calls.some((call) => call.method === "_goose/unstable/providers/config/save")
	) {
		await Bun.sleep(1);
	}
	await expect(startProviderLogin("browser-b", "openai", "api_key")).rejects.toThrow(
		"already in progress for this provider",
	);
	await Bun.sleep(40);
	await saving;
	const replacement = await startProviderLogin("browser-b", "openai", "api_key");
	cancelProviderLogin("browser-b", replacement.loginId);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("Goose slash commands and mapped session history are projected", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	await promptSession(created.sessionId, "new prompt");
	await Bun.sleep(0);
	expect(await getSessionCommands(created.sessionId)).toMatchObject([
		{ name: "review", source: "goose" },
	]);
	const result = await searchSessionHistory({
		query: "new prompt",
		scope: { kind: "project", projectId: "project" },
		limit: 10,
	});
	expect(result).toMatchObject({
		indexing: false,
		incomplete: false,
		promptTotal: 1,
		prompts: [
			{
				sessionId: created.sessionId,
				projectId: "project",
				text: "new prompt",
				timestamp: Date.parse("2026-01-02T03:04:05Z"),
			},
		],
	});
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("history indexing releases replay state and retries transient loads", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	disposeAllSessions();
	f.connection.loadFailures = 1;
	const first = await searchSessionHistory({
		query: "saved prompt",
		scope: { kind: "project", projectId: "project" },
	});
	expect(first).toMatchObject({ indexing: true, incomplete: false, promptTotal: 0 });
	await Bun.sleep(310);
	const second = await searchSessionHistory({
		query: "saved prompt",
		scope: { kind: "project", projectId: "project" },
	});
	expect(second).toMatchObject({ indexing: false, incomplete: false, promptTotal: 1 });
	const loadsBeforeOpen = f.connection.calls.filter(
		(call) => call.method === "session/load",
	).length;
	await getSessionMessages(created.sessionId, "project", f.directory);
	const loadsAfterOpen = f.connection.calls.filter((call) => call.method === "session/load").length;
	expect(loadsAfterOpen).toBe(loadsBeforeOpen + 1);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("a normal session operation adopts a concurrently indexed session", async () => {
	const f = fixture();
	const created = await createSession({ projectId: "project", cwd: f.directory });
	disposeAllSessions();
	let releaseLoad = () => {};
	f.connection.loadGate = new Promise<void>((resolve) => {
		releaseLoad = resolve;
	});
	const search = searchSessionHistory({ query: "saved", scope: { kind: "all" } });
	while (!f.connection.calls.some((call) => call.method === "session/load")) await Bun.sleep(0);
	const commands = getSessionCommands(created.sessionId);
	releaseLoad();
	await Promise.all([search, commands]);
	const loadsBeforeRead = f.connection.calls.filter(
		(call) => call.method === "session/load",
	).length;
	await getSessionMessages(created.sessionId, "project", f.directory);
	const loadsAfterRead = f.connection.calls.filter((call) => call.method === "session/load").length;
	expect(loadsAfterRead).toBe(loadsBeforeRead);
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("history search reports an incomplete index after bounded load retries", async () => {
	const f = fixture();
	await createSession({ projectId: "project", cwd: f.directory });
	disposeAllSessions();
	f.connection.loadFailures = 3;
	let result = await searchSessionHistory({ query: "saved", scope: { kind: "all" } });
	expect(result).toMatchObject({ indexing: true, incomplete: false });
	await Bun.sleep(310);
	result = await searchSessionHistory({ query: "saved", scope: { kind: "all" } });
	expect(result).toMatchObject({ indexing: true, incomplete: false });
	await Bun.sleep(610);
	result = await searchSessionHistory({ query: "saved", scope: { kind: "all" } });
	expect(result).toMatchObject({ indexing: false, incomplete: true });
	disposeAllSessions();
	rmSync(f.directory, { recursive: true, force: true });
});

test("an unconfigured Goose client fails clearly", async () => {
	setGooseClient(undefined);
	delete process.env.GOOSEBERRY_GOOSE_SECRET_KEY;
	expect(() => gooseRecipes()).toThrow("Goose is not configured");
});
