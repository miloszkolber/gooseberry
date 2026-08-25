import type { GitDiffScope, Project, WireModel, Workspace } from "@mewa-code/contracts";
import { isAbsolutePath, normalizePath } from "../lib";
import type { ClosedChat, EditorTab, RouteChatTarget } from "./app-store";

interface ConnectionGenerationState {
	status: string;
	connectionGeneration: number;
}

export function isConnectedGeneration(
	state: ConnectionGenerationState,
	connectionGeneration: number,
): boolean {
	return state.status === "connected" && state.connectionGeneration === connectionGeneration;
}

interface ActiveWorkspaceState {
	activeWorkspaceId: string | null;
	workspaces: Record<string, Workspace[]>;
}

interface ProjectContextState extends ActiveWorkspaceState {
	selectedProjectId: string | null;
	projects: Project[];
}

export function isDefaultWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return workspace.kind === "default";
}

export function isExternalWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return workspace.kind === "external";
}

export function isUserOwnedWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return isDefaultWorkspace(workspace) || isExternalWorkspace(workspace);
}

export function selectActiveWorkspace(state: ActiveWorkspaceState): Workspace | null {
	return state.activeWorkspaceId ? selectWorkspaceById(state, state.activeWorkspaceId) : null;
}

export function selectWorkspaceById(
	state: ActiveWorkspaceState,
	workspaceId: string,
): Workspace | null {
	for (const workspaces of Object.values(state.workspaces)) {
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
		if (workspace) return workspace;
	}
	return null;
}

export function selectActiveWorkspaceProjectId(state: ActiveWorkspaceState): string | null {
	return selectActiveWorkspace(state)?.projectId ?? null;
}

export function selectContextProject(state: ProjectContextState): Project | null {
	const projectId = selectActiveWorkspace(state)?.projectId ?? state.selectedProjectId;
	return state.projects.find((project) => project.id === projectId) ?? null;
}

export interface HistoryTarget {
	workspaceId: string;
	tabId: string;
	sessionId: string;
}

export function selectActiveEditorTab(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): EditorTab | null {
	const activeId = state.activeTabByWorkspace[workspaceId];
	return (state.tabsByWorkspace[workspaceId] ?? []).find((tab) => tab.id === activeId) ?? null;
}

export function selectHistoryTarget(state: {
	activeWorkspaceId: string | null;
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
}): HistoryTarget | null {
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return null;
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const active = selectActiveEditorTab(state, workspaceId);
	const chat = active?.kind === "chat" ? active : tabs.findLast((t) => t.kind === "chat");
	return chat ? { workspaceId, tabId: chat.id, sessionId: chat.sessionId } : null;
}

export interface KnownChatLocation {
	workspaceId: string;
	title: string;
}

export function selectKnownChatLocation(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		closedChatsByWorkspace: Record<string, ClosedChat[]>;
	},
	sessionId: string,
): KnownChatLocation | null {
	for (const [workspaceId, tabs] of Object.entries(state.tabsByWorkspace)) {
		const tab = tabs.find(
			(candidate) => candidate.kind === "chat" && candidate.sessionId === sessionId,
		);
		if (tab?.kind === "chat") return { workspaceId, title: tab.name };
	}
	for (const [workspaceId, chats] of Object.entries(state.closedChatsByWorkspace)) {
		const chat = chats.find((candidate) => candidate.sessionId === sessionId);
		if (chat) return { workspaceId, title: chat.title };
	}
	return null;
}

export function selectWorkspaceSessionIds(
	state: {
		tabsByWorkspace: Record<string, EditorTab[]>;
		closedChatsByWorkspace: Record<string, ClosedChat[]>;
	},
	workspaceId: string,
): string[] {
	const sessionIds = new Set(
		(state.tabsByWorkspace[workspaceId] ?? []).flatMap((tab) =>
			tab.kind === "chat" ? [tab.sessionId] : [],
		),
	);
	for (const chat of state.closedChatsByWorkspace[workspaceId] ?? []) {
		sessionIds.add(chat.sessionId);
	}
	return [...sessionIds];
}

export function selectCatalogModel(
	models: readonly WireModel[],
	ref: Pick<WireModel, "provider" | "id"> | null,
): WireModel | null {
	if (!ref) return null;
	return models.find((m) => m.provider === ref.provider && m.id === ref.id) ?? null;
}

export const BRANCH_SCOPE: GitDiffScope = { kind: "branch" };

export function selectDiffScope(
	state: { diffScopeByWorkspace: Record<string, GitDiffScope> },
	workspaceId: string,
): GitDiffScope {
	return state.diffScopeByWorkspace[workspaceId] ?? BRANCH_SCOPE;
}

export function selectDiffBaseRef(state: ActiveWorkspaceState, workspaceId: string): string {
	const workspace = selectWorkspaceById(state, workspaceId);
	return workspace ? (workspace.diffBase ?? workspace.baseBranch) : "";
}

export function selectDiffTabTargetRef(
	state: ActiveWorkspaceState,
	tab: { workspaceId: string; scope: GitDiffScope },
): string {
	return tab.scope.kind === "branch" ? selectDiffBaseRef(state, tab.workspaceId) : "";
}

export function matchesWorktreePath(reported: string, rel: string): boolean {
	const path = normalizePath(reported);
	if (path === rel) return true;
	return isAbsolutePath(path) && path.endsWith(`/${rel}`);
}

export function selectChatTitle(
	state: { tabsByWorkspace: Record<string, EditorTab[]> },
	workspaceId: string,
	sessionId: string,
): string {
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const chatTab = tabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
	return (chatTab?.name ?? "Chat").trim() || "Chat";
}

export function selectWorkspaceTick(
	state: { fsChangesByWorkspace: Record<string, { tick: number }> },
	workspaceId: string,
): number {
	return state.fsChangesByWorkspace[workspaceId]?.tick ?? 0;
}

export function selectCurrentRouteChatTarget(state: {
	routeChatTarget: RouteChatTarget | null;
	activeWorkspaceId: string | null;
	navTickByWorkspace: Record<string, number>;
}): RouteChatTarget | null {
	const target = state.routeChatTarget;
	if (!target || state.activeWorkspaceId !== target.workspaceId) return null;
	return selectWorkspaceNavTick(state, target.workspaceId) === target.navTick ? target : null;
}

export function selectWorkspaceNavTick(
	state: { navTickByWorkspace: Record<string, number> },
	workspaceId: string,
): number {
	return state.navTickByWorkspace[workspaceId] ?? 0;
}

interface SkillsStaleState {
	skillChangeTickByWorkspace: Record<string, number>;
	skillsSyncedTickBySession: Record<string, number>;
}

export function selectSkillsStale(
	state: SkillsStaleState,
	workspaceId: string,
	sessionId: string,
): boolean {
	return (
		(state.skillChangeTickByWorkspace[workspaceId] ?? 0) >
		(state.skillsSyncedTickBySession[sessionId] ?? 0)
	);
}

export function selectLastOpenChatSession(
	state: {
		tabsByWorkspace: Record<string, { kind: string; id: string; sessionId?: string }[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): string | null {
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const activeId = state.activeTabByWorkspace[workspaceId];
	const active = tabs.find((t) => t.id === activeId);
	if (active?.kind === "chat" && active.sessionId) return active.sessionId;
	for (let i = tabs.length - 1; i >= 0; i--) {
		const tab = tabs[i];
		if (tab?.kind === "chat" && tab.sessionId) return tab.sessionId;
	}
	return null;
}
