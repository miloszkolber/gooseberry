import { beforeEach, expect, test } from "bun:test";
import type { Project, SessionGoal } from "@gooseberry/contracts";
import {
	chatTabId,
	EMPTY_RUNTIME,
	projectArea,
	reduceSessionEvent,
	useAppStore,
} from "@/store/app-store";

const project: Project = {
	id: "p1",
	name: "Project",
	roots: ["/tmp/project"],
	slug: "project",
	lastOpened: 1,
};
const area = projectArea(project);

test("a project area can select any admitted project root for new chats", () => {
	const multiRoot = { ...project, roots: ["/tmp/project", "/tmp/other"] };
	expect(projectArea(multiRoot, "/tmp/other").root).toBe("/tmp/other");
	expect(projectArea(multiRoot, "/tmp/missing").root).toBe("/tmp/project");
});

test("content identity keeps same-path files and diffs isolated by their owning root", () => {
	const state = useAppStore.getState();
	state.openTab(
		{
			kind: "file",
			id: "file-a",
			projectAreaId: "p1",
			root: "/tmp/project",
			name: "README.md",
			path: "README.md",
			content: "first",
		},
		"keep",
	);
	state.openTab(
		{
			kind: "file",
			id: "file-b",
			projectAreaId: "p1",
			root: "/tmp/other",
			name: "README.md",
			path: "README.md",
			content: "second",
		},
		"keep",
	);
	state.openTab(
		{
			kind: "diff",
			id: "diff-a",
			projectAreaId: "p1",
			repository: "/tmp/project/repo",
			name: "file.ts",
			path: "src/file.ts",
			scope: { kind: "commit", sha: "aaaa" },
			loadedTarget: "aaaa",
			original: "before-a",
			modified: "after-a",
		},
		"keep",
	);
	state.openTab(
		{
			kind: "diff",
			id: "diff-b",
			projectAreaId: "p1",
			repository: "/tmp/other/repo",
			name: "file.ts",
			path: "src/file.ts",
			scope: { kind: "commit", sha: "bbbb" },
			loadedTarget: "bbbb",
			original: "before-b",
			modified: "after-b",
		},
		"keep",
	);
	for (const [id, baseRef] of [
		["diff-main", "refs/heads/main"],
		["diff-release", "refs/heads/release"],
	] as const) {
		state.openTab(
			{
				kind: "diff",
				id,
				projectAreaId: "p1",
				repository: "/tmp/project/repo",
				name: "file.ts",
				path: "src/file.ts",
				scope: { kind: "branch", baseRef },
				loadedTarget: baseRef,
				original: "before",
				modified: "after",
			},
			"keep",
		);
	}
	expect(useAppStore.getState().tabsByProjectArea.p1).toHaveLength(6);
});

beforeEach(() => {
	useAppStore.setState({
		projects: [project],
		recentProjects: [project],
		projectAreas: { p1: [area] },
		selectedProjectId: "p1",
		activeProjectAreaId: "p1",
		removedProjectAreaIds: {},
		tabsByProjectArea: {},
		activeTabByProjectArea: { p1: null },
		previewTabByProjectArea: {},
		closedChatsByProjectArea: {},
		sessionCatalogVersionByProjectArea: {},
		activeActivityByProjectArea: {},
		sessions: {},
		deletedSessionsByProjectArea: {},
		navTickByProjectArea: {},
		changesRequest: null,
		chatLocationRequest: null,
		routeChatTarget: null,
		historyOpenRequest: null,
		pendingPermissions: {},
	});
});

test("live text preserves thinking and parallel tool calls after terminal tool updates", () => {
	let runtime = reduceSessionEvent(EMPTY_RUNTIME, { type: "thinking", text: "planning" });
	runtime = reduceSessionEvent(runtime, {
		type: "tool-start",
		toolCallId: "shell-call",
		toolName: "shell_execute",
		tool: { command: "false" },
	});
	runtime = reduceSessionEvent(runtime, {
		type: "tool-start",
		toolCallId: "read-call",
		toolName: "filesystem_read",
		tool: { path: "README.md" },
	});
	runtime = reduceSessionEvent(runtime, {
		type: "tool-end",
		toolCallId: "shell-call",
		status: "failed",
		tool: { error: "exit 1" },
	});
	runtime = reduceSessionEvent(runtime, {
		type: "tool-end",
		toolCallId: "read-call",
		status: "completed",
		tool: { text: "ok" },
	});
	runtime = reduceSessionEvent(runtime, { type: "text", text: "Finished." });

	const assistant = runtime.turns.find((turn) => turn.kind === "assistant");
	expect(assistant?.kind === "assistant" ? assistant.message.content : []).toEqual([
		{ type: "thinking", thinking: "planning" },
		{
			type: "toolCall",
			id: "shell-call",
			toolName: "shell_execute",
			name: "shell_execute",
			arguments: { command: "false" },
		},
		{
			type: "toolCall",
			id: "read-call",
			toolName: "filesystem_read",
			name: "filesystem_read",
			arguments: { path: "README.md" },
		},
		{ type: "text", text: "Finished." },
	]);
	expect(runtime.toolResults).toMatchObject({
		"shell-call": { status: "error", raw: { error: "exit 1" } },
		"read-call": { status: "done", raw: { text: "ok" } },
	});
});

test("live assistant content only merges adjacent compatible blocks", () => {
	let runtime = reduceSessionEvent(EMPTY_RUNTIME, { type: "text", text: "first" });
	runtime = reduceSessionEvent(runtime, { type: "thinking", text: "plan" });
	const beforeThinkingChunk = runtime;
	runtime = reduceSessionEvent(runtime, { type: "thinking", text: "ning" });
	const priorAssistant = beforeThinkingChunk.turns.find((turn) => turn.kind === "assistant");
	expect(priorAssistant?.kind === "assistant" ? priorAssistant.message.content : []).toEqual([
		{ type: "text", text: "first" },
		{ type: "thinking", thinking: "plan" },
	]);
	expect(runtime.currentAssistantId).toBe(beforeThinkingChunk.currentAssistantId);
	runtime = reduceSessionEvent(runtime, {
		type: "tool-start",
		toolCallId: "read",
		toolName: "read",
	});
	runtime = reduceSessionEvent(runtime, { type: "thinking", text: "check" });
	runtime = reduceSessionEvent(runtime, { type: "text", text: "last" });
	const assistant = runtime.turns.find((turn) => turn.kind === "assistant");
	expect(assistant?.kind === "assistant" ? assistant.message.content : []).toEqual([
		{ type: "text", text: "first" },
		{ type: "thinking", thinking: "planning" },
		{ type: "toolCall", id: "read", toolName: "read", name: "read", arguments: {} },
		{ type: "thinking", thinking: "check" },
		{ type: "text", text: "last" },
	]);
});

test("live assistant images retain their place between text blocks", () => {
	let runtime = reduceSessionEvent(EMPTY_RUNTIME, { type: "text", text: "before" });
	runtime = reduceSessionEvent(runtime, {
		type: "image",
		image: { type: "image", data: "AA==", mimeType: "image/png" },
	});
	runtime = reduceSessionEvent(runtime, { type: "text", text: "after" });
	const assistant = runtime.turns.find((turn) => turn.kind === "assistant");
	expect(assistant?.kind === "assistant" ? assistant.message.content : []).toEqual([
		{ type: "text", text: "before" },
		{ type: "image", data: "AA==", mimeType: "image/png" },
		{ type: "text", text: "after" },
	]);
});

test("a welcome snapshot replaces stale permissions and restores pending approvals", () => {
	useAppStore.getState().setPendingPermission({
		id: "stale",
		sessionId: "old-session",
		toolCallId: "old-tool",
		title: "Old",
		options: [],
	});
	useAppStore.getState().installWelcomeSnapshot(57, [project], [project], undefined, [
		{
			id: "permission-1",
			sessionId: "reconnected-session",
			toolCallId: "tool-1",
			title: "Run command",
			options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
		},
	]);

	expect(useAppStore.getState().pendingPermissions).toEqual({
		"reconnected-session": {
			"permission-1": {
				id: "permission-1",
				sessionId: "reconnected-session",
				toolCallId: "tool-1",
				title: "Run command",
				options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }],
			},
		},
	});
});

test("opening a chat creates and focuses one content tab", () => {
	useAppStore.getState().openChatSession("p1", "s1", null, "medium");
	const state = useAppStore.getState();
	expect(state.tabsByProjectArea.p1).toEqual([
		{ kind: "chat", id: chatTabId("p1", "s1"), projectAreaId: "p1", name: "Chat", sessionId: "s1" },
	]);
	expect(state.activeTabByProjectArea.p1).toBe(chatTabId("p1", "s1"));
});

test("closing a chat moves it to local history", () => {
	useAppStore.getState().openChatSession("p1", "s1", null, "medium");
	useAppStore.getState().closeChatToHistory("s1", "p1", false);
	const state = useAppStore.getState();
	expect(state.tabsByProjectArea.p1).toEqual([]);
	expect(state.closedChatsByProjectArea.p1?.[0]?.sessionId).toBe("s1");
	expect(state.sessions.s1).toBeUndefined();
});

test("closing a running chat retains its live runtime", () => {
	useAppStore.getState().openChatSession("p1", "running", null, "medium");
	useAppStore.getState().handleAgentEvent({ type: "agent_start" }, "running");
	useAppStore.getState().closeChatToHistory("running", "p1", false);
	expect(useAppStore.getState().sessions.running?.isStreaming).toBe(true);
});

test("Goose session lifecycle pushes rename and archive local presentation without deleting", () => {
	useAppStore.getState().openChatSession("p1", "s1", null, "medium");
	useAppStore
		.getState()
		.applySessionLifecycle({ projectId: "p1", sessionId: "s1", operation: "created" });
	expect(useAppStore.getState().sessionCatalogVersionByProjectArea.p1).toBe(1);
	useAppStore.getState().applySessionLifecycle({
		projectId: "p1",
		sessionId: "s1",
		operation: "renamed",
		title: "Focused work",
	});
	expect(useAppStore.getState().tabsByProjectArea.p1?.[0]?.name).toBe("Focused work");
	useAppStore.getState().applySessionLifecycle({
		projectId: "p1",
		sessionId: "s1",
		operation: "archived",
	});
	const archived = useAppStore.getState();
	expect(archived.tabsByProjectArea.p1).toEqual([]);
	expect(archived.sessions.s1).toBeUndefined();
	expect(archived.deletedSessionsByProjectArea.p1?.s1).toBeUndefined();
	expect(archived.sessionCatalogVersionByProjectArea.p1).toBe(3);
	archived.applySessionLifecycle({ projectId: "p1", sessionId: "s1", operation: "unarchived" });
	expect(useAppStore.getState().sessionCatalogVersionByProjectArea.p1).toBe(4);
});

test("authoritative session reconciliation repairs missed chat title pushes", () => {
	useAppStore.getState().openChatSession("p1", "open", null, "medium");
	useAppStore.getState().openChatSession("p1", "closed", null, "medium");
	useAppStore.getState().closeChatToHistory("closed", "p1", false);
	useAppStore.getState().reconcileProjectAreaSessions(
		"p1",
		["open", "closed"],
		[
			{ sessionId: "open", title: "Renamed open chat", archived: false },
			{ sessionId: "closed", title: "Renamed closed chat", archived: false },
		],
	);
	const state = useAppStore.getState();
	expect(state.tabsByProjectArea.p1?.find((tab) => tab.kind === "chat")?.name).toBe(
		"Renamed open chat",
	);
	expect(state.closedChatsByProjectArea.p1?.[0]?.title).toBe("Renamed closed chat");
});

test("missed archive reconciliation does not tombstone a restorable chat", () => {
	useAppStore.getState().openChatSession("p1", "archived", null, "medium");
	useAppStore
		.getState()
		.reconcileProjectAreaSessions(
			"p1",
			["archived"],
			[{ sessionId: "archived", title: "Archived chat", archived: true }],
		);
	expect(useAppStore.getState().tabsByProjectArea.p1).toEqual([]);
	expect(useAppStore.getState().deletedSessionsByProjectArea.p1?.archived).toBeUndefined();
	useAppStore
		.getState()
		.applySessionLifecycle({ projectId: "p1", sessionId: "archived", operation: "unarchived" });
	useAppStore
		.getState()
		.noteClosedChats("p1", [{ sessionId: "archived", title: "Restored chat", closedAt: 42 }]);
	useAppStore.getState().reopenChat("p1", "archived");
	expect(useAppStore.getState().tabsByProjectArea.p1?.[0]).toMatchObject({
		kind: "chat",
		sessionId: "archived",
		name: "Restored chat",
	});
});

test("missed deletion reconciliation tombstones late hydration", () => {
	useAppStore.getState().openChatSession("p1", "deleted", null, "medium");
	useAppStore.getState().reconcileProjectAreaSessions("p1", ["deleted"], []);
	expect(useAppStore.getState().deletedSessionsByProjectArea.p1?.deleted).toBe(true);
	useAppStore.getState().hydrateSession(
		{
			sessionId: "deleted",
			projectId: "p1",
			cwd: "/workspace",
			title: "Stale chat",
			model: null,
			thinkingLevel: "off",
			isStreaming: false,
			messageCount: 0,
			updatedAt: 42,
			live: false,
			archived: false,
		},
		{ turns: [], toolResults: {}, askAnswers: {}, turnIdByMessageIndex: [] },
	);
	expect(useAppStore.getState().sessions.deleted).toBeUndefined();
	expect(useAppStore.getState().tabsByProjectArea.p1).toEqual([]);
});

test("activity requests select the fixed activity panel", () => {
	useAppStore.getState().requestToolView("p1", "files");
	expect(useAppStore.getState().activeActivityByProjectArea.p1).toBe("files");
	useAppStore.getState().requestChangesView("p1", "src/a.ts");
	expect(useAppStore.getState().activeActivityByProjectArea.p1).toBe("changes");
	expect(useAppStore.getState().changesRequest).toMatchObject({
		projectAreaId: "p1",
		path: "src/a.ts",
	});
});

test("route chat activation advances the local navigation tick", () => {
	useAppStore.getState().activateProjectAreaFromRoute(area, "s1");
	const state = useAppStore.getState();
	expect(state.routeChatTarget?.sessionId).toBe("s1");
	expect(state.routeChatTarget?.navTick).toBe(state.navTickByProjectArea.p1);
});

test("session goal state keeps loading, ready, and error transitions isolated to one runtime", () => {
	useAppStore.getState().openChatSession("p1", "s1", null, "medium");
	useAppStore.getState().openChatSession("p1", "s2", null, "medium");
	useAppStore.getState().setSessionGoalLoading("s1", "p1");
	useAppStore.getState().setSessionGoal("s1", {
		projectId: "p1",
		sessionId: "s1",
		goal: "Ship the focused chat",
		tasks: [],
		updatedAt: 42,
	} satisfies SessionGoal);
	useAppStore.getState().setSessionGoalError("s2", "p1", "not found");

	expect(useAppStore.getState().sessions.s1?.goal).toMatchObject({
		projectAreaId: "p1",
		status: "ready",
		goal: "Ship the focused chat",
		updatedAt: 42,
		error: null,
	});
	expect(useAppStore.getState().sessions.s2?.goal).toMatchObject({
		projectAreaId: "p1",
		status: "error",
		goal: null,
		error: "not found",
	});
});

test("session hydration restores controller queues and question replies", () => {
	useAppStore.getState().hydrateSession(
		{
			sessionId: "s1",
			projectId: "p1",
			cwd: "/workspace",
			title: "Queued chat",
			model: null,
			thinkingLevel: "off",
			isStreaming: true,
			messageCount: 0,
			updatedAt: 42,
			live: true,
			archived: false,
			parentSessionId: "parent-session",
			queue: { revision: "loaded", steering: [], followUp: ["continue after refresh"] },
		},
		{ turns: [], toolResults: {}, askAnswers: {}, turnIdByMessageIndex: [] },
	);
	const result = { answers: [], cancelled: true };
	useAppStore.getState().setAskAnswer("s1", "question-1", result);
	expect(useAppStore.getState().sessions.s1?.queue.followUp).toEqual(["continue after refresh"]);
	expect(useAppStore.getState().sessions.s1?.queue.revision).toBe("loaded");
	useAppStore.getState().handleAgentEvent(
		{
			type: "queue_update",
			revision: "changed",
			steering: [],
			followUp: ["continue after refresh"],
		},
		"s1",
	);
	expect(useAppStore.getState().sessions.s1?.queue.revision).toBe("changed");
	expect(useAppStore.getState().sessions.s1?.parentSessionId).toBe("parent-session");
	expect(useAppStore.getState().sessions.s1?.askAnswers["question-1"]).toEqual(result);
	useAppStore.getState().reconcileProjectAreaSessions(
		"p1",
		["s1"],
		[
			{
				sessionId: "s1",
				title: "Queued chat",
				archived: false,
				queue: { revision: "reconciled", steering: [], followUp: [] },
			},
		],
	);
	expect(useAppStore.getState().sessions.s1?.queue.followUp).toEqual([]);
	expect(useAppStore.getState().sessions.s1?.queue.revision).toBe("reconciled");
	expect(useAppStore.getState().sessions.s1?.parentSessionId).toBe("parent-session");
});
