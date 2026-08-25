import { describe, expect, test } from "bun:test";
import * as acp from "@agentclientprotocol/sdk";
import type {
	PiEvent,
	Project,
	ToolResultMessage,
	TranscriptMessage,
	Workspace,
} from "@mewa-code/contracts";
import {
	type AcpConnectorDependencies,
	type AcpPromptInput,
	convertAcpPromptBlocks,
	createAcpAgent,
	projectAcpEvent,
	projectTranscriptMessage,
} from "./connector";

const CWD = "/workspace/project";
const OTHER_CWD = "/workspace/other";
const PROJECT_ID = "project-1";
const OTHER_PROJECT_ID = "project-2";
const WORKSPACE_ID = "workspace-1";
const OTHER_WORKSPACE_ID = "workspace-2";
const SESSION_ID = "session-1";

type SessionPublisher = Parameters<AcpConnectorDependencies["setSessionPublisher"]>[0];

interface FakeAcpState {
	dependencies: Partial<AcpConnectorDependencies>;
	created?: { cwd: string; workspaceId: string };
	promptInput?: AcpPromptInput;
	settlement: unknown;
	publish: SessionPublisher;
	releasePrompt?: () => void;
	promptStarted?: Promise<void>;
}

function fakeAcpState(messages: TranscriptMessage[] = []): FakeAcpState {
	const project: Project = {
		id: PROJECT_ID,
		name: "project",
		path: CWD,
		slug: "project",
		lastOpened: 1,
	};
	const otherProject: Project = {
		id: OTHER_PROJECT_ID,
		name: "other",
		path: OTHER_CWD,
		slug: "other",
		lastOpened: 1,
	};
	const workspace: Workspace = {
		id: WORKSPACE_ID,
		projectId: PROJECT_ID,
		name: "project",
		branch: "main",
		worktreePath: CWD,
		baseBranch: "main",
	};
	const otherWorkspace: Workspace = {
		id: OTHER_WORKSPACE_ID,
		projectId: OTHER_PROJECT_ID,
		name: "other",
		branch: "main",
		worktreePath: OTHER_CWD,
		baseBranch: "main",
	};
	const projects = [project, otherProject];
	const workspaces = [workspace, otherWorkspace];
	const state: FakeAcpState = {
		dependencies: {},
		settlement: undefined,
		publish: () => {},
	};
	state.dependencies = {
		assertMountedDirectory: (path) => {
			if (path !== CWD && path !== OTHER_CWD) throw new Error("outside mount");
			return path;
		},
		createSession: async ({ cwd, workspaceId }) => {
			state.created = { cwd, workspaceId };
			return { sessionId: SESSION_ID, model: null, thinkingLevel: "medium" };
		},
		ensureWorkspaceScratchDir: () => {},
		getProjects: () => projects,
		getSessionCwd: () => CWD,
		getSessionMessages: async () => ({ summary: {} as never, messages }),
		getSessionSettlement: () => state.settlement as never,
		getSessionWorkspaceId: () => WORKSPACE_ID,
		getWorkspace: (id) => workspaces.find((candidate) => candidate.id === id) as Workspace,
		isSessionStreaming: () => false,
		listWorkspaces: (id) => workspaces.filter((candidate) => candidate.projectId === id),
		openProject: (path) => (path === OTHER_CWD ? otherProject : project),
		promptSession: async (_sessionId, text, images) => {
			state.promptInput = { text, ...(images ? { images } : {}) };
		},
		setExtUiPublisher: () => {},
		setSessionDeletedPublisher: () => {},
		setSessionPublisher: (publisher) => {
			state.publish = publisher;
		},
		setSkillAdmissionResolver: () => {},
		settleSessionsForShutdown: async () => {},
		disposeAllSessions: () => {},
		cancelExtUiForSession: () => {},
		abortSession: async () => {
			state.settlement = { stopReason: "aborted" };
			state.releasePrompt?.();
		},
	};
	return state;
}

async function withAcpConnection<T>(
	state: FakeAcpState,
	run: (context: acp.ClientContext, updates: acp.SessionNotification[]) => Promise<T>,
): Promise<T> {
	const updates: acp.SessionNotification[] = [];
	const handle = createAcpAgent({
		appVersion: "test",
		dependencies: state.dependencies,
	});
	const client = acp
		.client({ name: "test-client" })
		.onNotification(acp.methods.client.session.update, ({ params }) => {
			updates.push(params);
		});
	try {
		return await client.connectWith(handle.app, async (context) => {
			await context.request(acp.methods.agent.initialize, {
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
				clientInfo: { name: "test-client", version: "1" },
			});
			return run(context, updates);
		});
	} finally {
		await handle.close();
	}
}

describe("convertAcpPromptBlocks", () => {
	test("preserves text and images and renders resource links as bounded text", () => {
		expect(
			convertAcpPromptBlocks([
				{ type: "text", text: "hello" },
				{ type: "resource_link", name: "notes", uri: "file:///tmp/notes.txt" },
				{ type: "image", data: "AQID", mimeType: "image/png" },
			]),
		).toEqual({
			text: "hello\n[resource: notes (file:///tmp/notes.txt)]",
			images: [{ type: "image", data: "AQID", mimeType: "image/png" }],
		});
	});

	test("rejects unsupported blocks and malformed image data", () => {
		expect(() =>
			convertAcpPromptBlocks([{ type: "audio", data: "AQID", mimeType: "audio/wav" }]),
		).toThrow("audio prompt blocks are unsupported");
		expect(() =>
			convertAcpPromptBlocks([{ type: "image", data: "not-base64", mimeType: "image/png" }]),
		).toThrow("valid padded base64");
	});
});

describe("projectTranscriptMessage", () => {
	test("projects persisted user, assistant, tool, and thinking content", () => {
		const user = {
			role: "user",
			content: [
				{ type: "text", text: "hello" },
				{ type: "image", data: "AQID", mimeType: "image/png" },
			],
			timestamp: 1,
		} as unknown as TranscriptMessage;
		const assistant = {
			role: "assistant",
			content: [
				{ type: "text", text: "answer" },
				{ type: "thinking", thinking: "reasoning" },
				{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "README.md" } },
			],
		} as unknown as TranscriptMessage;
		const tool = {
			role: "toolResult",
			toolCallId: "tool-1",
			content: [{ type: "text", text: "file contents" }],
			details: { exitCode: 0 },
			isError: false,
		} as unknown as ToolResultMessage;

		expect(projectTranscriptMessage(user, 2)).toEqual([
			{
				sessionUpdate: "user_message_chunk",
				messageId: "history-2",
				content: { type: "text", text: "hello" },
			},
			{
				sessionUpdate: "user_message_chunk",
				messageId: "history-2",
				content: { type: "image", data: "AQID", mimeType: "image/png" },
			},
		]);
		expect(projectTranscriptMessage(assistant, 3)).toEqual([
			{
				sessionUpdate: "agent_message_chunk",
				messageId: "history-3",
				content: { type: "text", text: "answer" },
			},
			{
				sessionUpdate: "agent_thought_chunk",
				messageId: "history-3",
				content: { type: "text", text: "reasoning" },
			},
			{
				sessionUpdate: "tool_call",
				toolCallId: "tool-1",
				title: "read",
				kind: "read",
				status: "pending",
				rawInput: { path: "README.md" },
			},
		]);
		expect(projectTranscriptMessage(tool, 4)).toEqual([
			{
				sessionUpdate: "tool_call_update",
				toolCallId: "tool-1",
				status: "completed",
				content: [{ type: "content", content: { type: "text", text: "file contents" } }],
				rawOutput: { exitCode: 0 },
			},
		]);
	});
});

describe("projectAcpEvent", () => {
	test("projects streamed text, thinking, and tool execution events", () => {
		const text = projectAcpEvent({
			type: "message_update",
			message: {} as never,
			assistantMessageEvent: { type: "text_delta", delta: "hi" } as never,
		} as PiEvent);
		const thinking = projectAcpEvent({
			type: "message_update",
			message: {} as never,
			assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } as never,
		} as PiEvent);
		const tool = projectAcpEvent({
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "bash",
			result: { content: [{ type: "text", text: "done" }] },
			isError: false,
		} as PiEvent);
		const toolStart = projectAcpEvent({
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "bash",
			args: { command: "pwd" },
		} as PiEvent);

		expect(text).toEqual({
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text: "hi" },
		});
		expect(thinking).toEqual({
			sessionUpdate: "agent_thought_chunk",
			content: { type: "text", text: "hmm" },
		});
		expect(tool).toEqual({
			sessionUpdate: "tool_call_update",
			toolCallId: "tool-1",
			status: "completed",
			content: [{ type: "content", content: { type: "text", text: "done" } }],
		});
		expect(toolStart).toEqual({
			sessionUpdate: "tool_call_update",
			toolCallId: "tool-1",
			title: "bash",
			kind: "execute",
			status: "in_progress",
			rawInput: { command: "pwd" },
		});
	});
});

test("createAcpAgent exposes only the supported initialization capabilities", async () => {
	const handle = createAcpAgent({ appVersion: "test" });
	try {
		const client = acp.client();
		await client.connectWith(handle.app, async (context) => {
			const response = await context.request(acp.methods.agent.initialize, {
				protocolVersion: acp.PROTOCOL_VERSION,
				clientCapabilities: {},
				clientInfo: { name: "test-client", version: "1" },
			});
			expect(response).toEqual({
				protocolVersion: acp.PROTOCOL_VERSION,
				agentInfo: { name: "mewa-code", title: "Mewa Code", version: "test" },
				authMethods: [],
				agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
			});
		});
	} finally {
		await handle.close();
	}
});

test("admits session/new only for a mounted workspace and records its owner", async () => {
	const state = fakeAcpState();
	const result = await withAcpConnection(state, async (context) =>
		context.request(acp.methods.agent.session.new, { cwd: CWD, mcpServers: [] }),
	);

	expect(result).toEqual({ sessionId: SESSION_ID });
	expect(state.created).toEqual({ cwd: CWD, workspaceId: WORKSPACE_ID });
});

test("rejects unsupported MCP and additional-directory setup", async () => {
	for (const params of [
		{
			cwd: CWD,
			mcpServers: [{ name: "unsupported", command: "/bin/false", args: [], env: [] }],
		},
		{ cwd: CWD, mcpServers: [], additionalDirectories: ["/workspace/other"] },
	]) {
		const state = fakeAcpState();
		await withAcpConnection(state, async (context) => {
			await expect(context.request(acp.methods.agent.session.new, params as never)).rejects.toThrow(
				/unsupported/,
			);
			return undefined;
		});
	}
});

test("rejects wrong cwd ownership and unattached session prompts", async () => {
	const state = fakeAcpState();
	await withAcpConnection(state, async (context) => {
		await context.request(acp.methods.agent.session.new, { cwd: CWD, mcpServers: [] });
		await expect(
			context.request(acp.methods.agent.session.load, {
				cwd: OTHER_CWD,
				mcpServers: [],
				sessionId: SESSION_ID,
			}),
		).rejects.toThrow("not owned by the requested cwd");
		await expect(
			context.request(acp.methods.agent.session.prompt, {
				sessionId: "unknown-session",
				prompt: [{ type: "text", text: "hello" }],
			}),
		).rejects.toThrow("not attached");
		return undefined;
	});
});

test("replays load history before the response and preserves update order", async () => {
	const state = fakeAcpState([
		{ role: "user", content: "hello", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "answer" }] },
	] as unknown as TranscriptMessage[]);
	await withAcpConnection(state, async (context, updates) => {
		await context.request(acp.methods.agent.session.load, {
			cwd: CWD,
			mcpServers: [],
			sessionId: SESSION_ID,
		});
		expect(updates.map((entry) => entry.update.sessionUpdate)).toEqual([
			"user_message_chunk",
			"agent_message_chunk",
		]);
		return undefined;
	});
});

test("converts text and image prompts and delivers Pi updates in order", async () => {
	const state = fakeAcpState();
	state.dependencies.promptSession = async (_sessionId, text, images) => {
		state.promptInput = { text, ...(images ? { images } : {}) };
		state.publish({
			sessionId: SESSION_ID,
			event: {
				type: "message_update",
				message: {},
				assistantMessageEvent: { type: "text_delta", delta: "one" },
			} as never,
		});
		state.publish({
			sessionId: SESSION_ID,
			event: {
				type: "message_update",
				message: {},
				assistantMessageEvent: { type: "text_delta", delta: "two" },
			} as never,
		});
	};
	const seen: string[] = [];
	await withAcpConnection(state, async (context, updates) => {
		await context.request(acp.methods.agent.session.new, { cwd: CWD, mcpServers: [] });
		const response = await context.request(acp.methods.agent.session.prompt, {
			sessionId: SESSION_ID,
			prompt: [
				{ type: "text", text: "hello" },
				{ type: "image", data: "AQID", mimeType: "image/png" },
			],
		});
		seen.push(
			...updates.map(
				(entry) => (entry.update as { content?: { text?: string } }).content?.text ?? "",
			),
		);
		expect(response).toEqual({ stopReason: "end_turn" });
		return undefined;
	});
	expect(state.promptInput).toEqual({
		text: "hello",
		images: [{ type: "image", data: "AQID", mimeType: "image/png" }],
	});
	expect(seen).toEqual(["one", "two"]);
});

test("maps session cancellation to the cancelled stop reason", async () => {
	const state = fakeAcpState();
	let startedResolve: (() => void) | undefined;
	state.promptStarted = new Promise<void>((resolve) => {
		startedResolve = resolve;
	});
	state.dependencies.promptSession = async () => {
		startedResolve?.();
		await new Promise<void>((resolve) => {
			state.releasePrompt = resolve;
		});
	};

	await withAcpConnection(state, async (context) => {
		await context.request(acp.methods.agent.session.new, { cwd: CWD, mcpServers: [] });
		const prompt = context.request(acp.methods.agent.session.prompt, {
			sessionId: SESSION_ID,
			prompt: [{ type: "text", text: "wait" }],
		});
		await state.promptStarted;
		await context.notify(acp.methods.agent.session.cancel, { sessionId: SESSION_ID });
		await expect(prompt).resolves.toEqual({ stopReason: "cancelled" });
		return undefined;
	});
});

test("emits only parseable NDJSON responses on the wire", async () => {
	const state = fakeAcpState();
	const handle = createAcpAgent({ appVersion: "test", dependencies: state.dependencies });
	const encoded = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const input = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(
				encoded.encode(
					`${JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "initialize",
						params: {
							protocolVersion: acp.PROTOCOL_VERSION,
							clientCapabilities: {},
							clientInfo: { name: "wire-client", version: "1" },
						},
					})}\n`,
				),
			);
			controller.close();
		},
	});
	const output = new WritableStream<Uint8Array>({
		write(chunk) {
			chunks.push(chunk);
		},
	});
	const connection = handle.app.connect(acp.ndJsonStream(output, input));
	try {
		await connection.closed;
	} finally {
		await handle.close();
	}
	const text = new TextDecoder().decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk])));
	expect(
		text
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)),
	).toHaveLength(1);
});
