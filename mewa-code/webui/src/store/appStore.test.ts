import { beforeEach, expect, test } from "bun:test";
import type { PiProfileDescriptor, Project, SessionGoal, Workspace } from "@mewa-code/contracts";
import { chatTabId, useAppStore } from "./appStore";

const project: Project = {
	id: "p1",
	name: "Project",
	path: "/tmp/project",
	slug: "project",
	lastOpened: 1,
};
const workspace: Workspace = {
	id: "w1",
	projectId: "p1",
	name: "Workspace",
	branch: "workspace",
	worktreePath: "/tmp/project",
	baseBranch: "main",
};

beforeEach(() => {
	useAppStore.setState({
		projects: [project],
		recentProjects: [project],
		workspaces: { p1: [workspace] },
		selectedProjectId: "p1",
		activeWorkspaceId: "w1",
		removedWorkspaceIds: {},
		tabsByWorkspace: {},
		activeTabByWorkspace: { w1: null },
		previewTabByWorkspace: {},
		closedChatsByWorkspace: {},
		activeActivityByWorkspace: {},
		sessions: {},
		deletedSessionsByWorkspace: {},
		navTickByWorkspace: {},
		changesRequest: null,
		chatLocationRequest: null,
		routeChatTarget: null,
		historyOpenRequest: null,
	});
});

test("opening a chat creates and focuses one fixed editor tab", () => {
	useAppStore.getState().openChatSession("w1", "s1", null, "medium");
	const state = useAppStore.getState();
	expect(state.tabsByWorkspace.w1).toEqual([
		{ kind: "chat", id: chatTabId("w1", "s1"), workspaceId: "w1", name: "Chat", sessionId: "s1" },
	]);
	expect(state.activeTabByWorkspace.w1).toBe(chatTabId("w1", "s1"));
});

test("closing a chat moves it to local history", () => {
	useAppStore.getState().openChatSession("w1", "s1", null, "medium");
	useAppStore.getState().closeChatToHistory("s1", "w1", false);
	const state = useAppStore.getState();
	expect(state.tabsByWorkspace.w1).toEqual([]);
	expect(state.closedChatsByWorkspace.w1?.[0]?.sessionId).toBe("s1");
});

test("activity requests select the fixed activity panel", () => {
	useAppStore.getState().requestToolView("w1", "files");
	expect(useAppStore.getState().activeActivityByWorkspace.w1).toBe("files");
	useAppStore.getState().requestChangesView("w1", "src/a.ts");
	expect(useAppStore.getState().activeActivityByWorkspace.w1).toBe("changes");
	expect(useAppStore.getState().changesRequest).toMatchObject({
		workspaceId: "w1",
		path: "src/a.ts",
	});
});

test("route chat activation advances the local navigation tick", () => {
	useAppStore.getState().activateWorkspaceFromRoute(workspace, "s1");
	const state = useAppStore.getState();
	expect(state.routeChatTarget?.sessionId).toBe("s1");
	expect(state.routeChatTarget?.navTick).toBe(state.navTickByWorkspace.w1);
});

test("session goal state keeps loading, ready, and error transitions isolated to one runtime", () => {
	useAppStore.getState().openChatSession("w1", "s1", null, "medium");
	useAppStore.getState().openChatSession("w1", "s2", null, "medium");
	useAppStore.getState().setSessionGoalLoading("s1", "w1");
	useAppStore.getState().setSessionGoal("s1", {
		workspaceId: "w1",
		sessionId: "s1",
		goal: "Ship the focused chat",
		active: true,
		updatedAt: 42,
	} satisfies SessionGoal);
	useAppStore.getState().setSessionGoalError("s2", "w1", "not found");

	expect(useAppStore.getState().sessions.s1?.goal).toMatchObject({
		workspaceId: "w1",
		status: "ready",
		goal: "Ship the focused chat",
		updatedAt: 42,
		error: null,
	});
	expect(useAppStore.getState().sessions.s2?.goal).toMatchObject({
		workspaceId: "w1",
		status: "error",
		goal: null,
		error: "not found",
	});
});

test("Pi profile state replaces the host snapshot without inventing capability defaults", () => {
	const profile: PiProfileDescriptor = {
		id: "mewa",
		label: "Mewa",
		capabilities: [
			{
				id: "browser",
				label: "Browser QA",
				description: "isolated",
				enabled: false,
				available: true,
			},
			{
				id: "protectedStateGuard",
				label: "Protected-state guard",
				description: "required",
				enabled: true,
				available: true,
				required: true,
			},
		],
	};
	useAppStore.getState().applyPiProfile(profile);
	expect(useAppStore.getState().piProfile).toEqual(profile);
});
