import { beforeEach, expect, test } from "bun:test";
import type { Project, SessionGoal } from "@gooseberry/contracts";
import {
	chatTabId,
	EMPTY_RUNTIME,
	projectArea,
	reduceSessionEvent,
	useAppStore,
} from "./app-store";

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
		{ type: "thinking", thinking: "plan" },
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
