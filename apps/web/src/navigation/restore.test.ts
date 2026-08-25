import { afterEach, expect, test } from "bun:test";
import type { Project, Workspace } from "@mewa-code/contracts";
import { useAppStore } from "../store";
import type { NavigationDriver } from "./driver";
import { deriveLocation, startNavigation } from "./restore";

function project(id: string): Project {
	return { id, name: id, path: `/tmp/${id}`, slug: id, lastOpened: 1 };
}

function workspace(id: string, projectId = "p1"): Workspace {
	return {
		id,
		projectId,
		name: id,
		branch: id,
		worktreePath: `/tmp/${projectId}/${id}`,
		baseBranch: "main",
	};
}

function fakeDriver(initial = "") {
	let fragment = initial;
	const handlers = new Set<(fragment: string) => void>();
	const writes: { kind: "replace" | "push"; fragment: string }[] = [];
	const driver: NavigationDriver = {
		read: () => fragment,
		replace: (next) => {
			fragment = next;
			writes.push({ kind: "replace", fragment: next });
		},
		push: (next) => {
			fragment = next;
			writes.push({ kind: "push", fragment: next });
		},
		onIncoming: (handler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
	};
	return {
		driver,
		writes,
		incoming: (next: string) => {
			fragment = next;
			for (const handler of handlers) handler(next);
		},
	};
}

afterEach(() => {
	useAppStore.setState({
		projects: [],
		recentProjects: [],
		workspaces: {},
		selectedProjectId: null,
		activeWorkspaceId: null,
		activeTabByWorkspace: {},
		tabsByWorkspace: {},
		navTickByWorkspace: {},
		welcomeGeneration: 0,
		routeChatTarget: null,
	});
});

test("deriveLocation follows the focused chat tab in the fixed editor strip", () => {
	const ws = workspace("w1");
	const location = deriveLocation({
		activeWorkspaceId: ws.id,
		selectedProjectId: "p1",
		workspaces: { p1: [ws] },
		tabsByWorkspace: {
			w1: [{ id: "chat", kind: "chat", sessionId: "s1" }],
		},
		activeTabByWorkspace: { w1: "chat" },
	});
	expect(location).toEqual({ kind: "chat", projectId: "p1", workspaceId: "w1", sessionId: "s1" });
});

test("startNavigation restores a workspace route without shared layout state", async () => {
	const p = project("p1");
	const ws = workspace("w1");
	const fake = fakeDriver("#/v1/projects/p1/workspaces/w1");
	useAppStore.getState().installWelcomeSnapshot(1, [p], [p]);
	const stop = startNavigation({ driver: fake.driver, listWorkspaces: async () => [ws] });
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(useAppStore.getState().activeWorkspaceId).toBe("w1");
	stop();
});

test("startNavigation emits a project route for user selection", () => {
	const p = project("p1");
	const fake = fakeDriver();
	useAppStore.getState().installWelcomeSnapshot(1, [p], [p]);
	const stop = startNavigation({ driver: fake.driver, listWorkspaces: async () => [] });
	useAppStore.getState().selectProject("p1");
	expect(fake.writes.at(-1)?.fragment).toBe("#/v1/projects/p1");
	stop();
});
