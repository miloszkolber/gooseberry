import type {
	GitDiffFile,
	GitDiffScope,
	Project,
	ProjectFsChangedPayload,
	SessionLifecycleChangedPayload,
	SessionModeState,
	SessionPlanState,
	SessionQueueState,
	SessionSummary,
	ThinkingLevel,
	WireModel,
} from "@gooseberry/contracts";
import type { StateCreator } from "zustand";
import type { HydratedRuntime } from "@/chat/hydrate";
import { randomId } from "@/lib";
import type { AppState } from "@/store/app-store";
import { omitKey } from "@/store/record";
import { createSessionRuntime, type SessionRuntime } from "../chat/session-runtime";
import {
	availableContentTabId,
	type ChatLocationRequest,
	type ChatTab,
	type ClosedChat,
	type ContentOpenOptions,
	type ContentTab,
	chatTabId,
	contentSessionId,
	type DiffTab,
	type ProjectArea,
	type ProjectAreaActivity,
	type RouteChatTarget,
	type TabIntent,
} from "./model";
import {
	type HistoryTarget,
	selectActiveProjectAreaProjectId,
	selectProjectAreaNavTick,
	selectProjectAreaSessionIds,
	selectProjectAreaTick,
} from "./selectors";

export interface WorkspaceState {
	projects: Project[];
	recentProjects: Project[];
	projectAreas: Record<string, ProjectArea[]>;
	removedProjectAreaIds: Record<string, true>;
	expandedProjectIds: Record<string, true>;
	selectedProjectId: string | null;
	activeProjectAreaId: string | null;
	routeChatTarget: RouteChatTarget | null;
	routeChatTargetGeneration: number;
	tabsByProjectArea: Record<string, ContentTab[]>;
	activeTabByProjectArea: Record<string, string | null>;
	previewTabByProjectArea: Record<string, string>;
	navTickByProjectArea: Record<string, number>;
	closedChatsByProjectArea: Record<string, ClosedChat[]>;
	sessionCatalogVersionByProjectArea: Record<string, number>;
	deletedSessionsByProjectArea: Record<string, Record<string, true>>;
	activeActivityByProjectArea: Record<string, ProjectAreaActivity>;
	changesRequest: {
		projectAreaId: string;
		path: string;
		navTick: number;
	} | null;
	chatLocationRequest: ChatLocationRequest | null;
	historyOpenRequest: { id: string; sessionId: string } | null;
	fsChangesByProjectArea: Record<
		string,
		{ tick: number; changes: ProjectFsChangedPayload["changes"]; truncated: boolean }
	>;
	skillChangeTickByProjectArea: Record<string, number>;
	skillsSyncedTickBySession: Record<string, number>;
	commandCatalogGeneration: number;
	installProjectSnapshot: (projects: Project[], recentProjects: Project[]) => void;
	applyProjectUpdated: (project: Project) => void;
	setProjectAreas: (projectId: string, projectAreas: ProjectArea[]) => void;
	addProjectArea: (projectArea: ProjectArea) => void;
	updateProjectArea: (projectArea: ProjectArea) => void;
	removeProjectArea: (projectId: string, projectAreaId: string) => void;
	applyProjectAreaRemoved: (projectId: string, projectAreaId: string) => void;
	selectProject: (projectId: string, opts?: { reveal?: boolean }) => void;
	toggleProjectExpanded: (projectId: string) => void;
	expandProject: (projectId: string) => void;
	hydrateExpandedProjects: (projectIds: readonly string[]) => void;
	selectMain: () => void;
	activateProjectArea: (projectArea: Pick<ProjectArea, "id" | "projectId">) => void;
	activateProjectAreaFromRoute: (
		projectArea: Pick<ProjectArea, "id" | "projectId">,
		sessionId?: string,
	) => void;
	validateRouteChatTarget: (sessionId: string) => void;
	clearRouteChatTarget: () => void;
	openTab: (tab: ContentTab, intent: TabIntent, options?: ContentOpenOptions) => void;
	closeTab: (id: string, countNavigation?: boolean, projectAreaId?: string) => void;
	setActiveTab: (id: string, intent?: TabIntent) => void;
	noteNavigation: (projectAreaId: string) => void;
	setFileTabView: (id: string, view: "rendered" | "source") => void;
	setDiffTabIgnoreWhitespace: (id: string, ignoreWhitespace: boolean) => void;
	changesView: "list" | "tree";
	setChangesView: (view: "list" | "tree") => void;
	diffScopeByProjectArea: Record<string, GitDiffScope>;
	setDiffScope: (projectAreaId: string, scope: GitDiffScope) => void;
	noteDiffComparison: (
		projectAreaId: string,
		repository: string,
		scope: GitDiffScope,
		comparisonId: string,
	) => void;
	noteFsChanged: (payload: ProjectFsChangedPayload) => void;
	markSkillsSynced: (sessionId: string, syncedTick: number) => void;
	noteCommandCatalogChanged: () => void;
	updateFileTabContent: (projectAreaId: string, id: string, content: string, tick: number) => void;
	updateDiffTabContent: (
		projectAreaId: string,
		id: string,
		preview: GitDiffFile,
		tick: number,
		loadedTarget: string,
	) => void;
	clearProjectAreaTabs: (projectAreaId: string) => void;
	setActiveActivity: (projectAreaId: string, activity: ProjectAreaActivity) => void;
	openChatSession: (
		projectAreaId: string,
		sessionId: string,
		model: WireModel | null,
		thinkingLevel: ThinkingLevel,
		modes?: SessionModeState | null,
		syncedTick?: number,
		options?: ContentOpenOptions,
	) => void;
	closeChatRuntime: (sessionId: string) => void;
	closeChatToHistory: (
		sessionId: string,
		projectAreaId?: string,
		countNavigation?: boolean,
	) => void;
	deleteChat: (projectAreaId: string, sessionId: string, countNavigation?: boolean) => void;
	applySessionLifecycle: (payload: SessionLifecycleChangedPayload) => void;
	reconcileProjectAreaSessions: (
		projectAreaId: string,
		baselineSessionIds: readonly string[],
		authoritativeSessions: readonly Pick<
			SessionSummary,
			"sessionId" | "title" | "archived" | "queue"
		>[],
	) => void;
	reopenChat: (projectAreaId: string, sessionId: string, options?: ContentOpenOptions) => void;
	noteClosedChats: (projectAreaId: string, entries: ClosedChat[]) => void;
	hydrateSession: (
		summary: SessionSummary,
		hydrated: HydratedRuntime,
		modes: SessionModeState | null,
		planState: SessionPlanState | null,
		activate?: boolean,
		syncedTick?: number,
		options?: ContentOpenOptions,
	) => void;
	requestToolView: (projectAreaId: string, tool: "files" | "changes") => void;
	requestChangesView: (projectAreaId: string, path: string) => void;
	clearChangesRequest: () => void;
	requestChatLocation: (req: ChatLocationRequest) => void;
	clearChatLocation: () => void;
	requestHistoryOpen: (target: HistoryTarget) => void;
	clearHistoryOpen: () => void;
}

function sortProjects(projects: Project[]): Project[] {
	return [...projects].sort((a, b) => b.lastOpened - a.lastOpened);
}

function upsertProject(projects: Project[], project: Project): Project[] {
	return projects.some((candidate) => candidate.id === project.id)
		? projects.map((candidate) => (candidate.id === project.id ? project : candidate))
		: [...projects, project];
}

function withExpandedProject(
	record: Record<string, true>,
	projectId: string,
): Record<string, true> {
	return record[projectId] ? record : { ...record, [projectId]: true };
}

function pruneExpandedProjects(
	state: Pick<AppState, "expandedProjectIds">,
	projects: Project[],
): Pick<AppState, "expandedProjectIds"> | Record<string, never> {
	const open = new Set(projects.map((project) => project.id));
	const kept = Object.keys(state.expandedProjectIds).filter((id) => open.has(id));
	if (kept.length === Object.keys(state.expandedProjectIds).length) return {};
	return {
		expandedProjectIds: Object.fromEntries(kept.map((id) => [id, true as const])),
	};
}

function reconcileProjectNavigation(
	state: Pick<AppState, "selectedProjectId" | "activeProjectAreaId" | "projectAreas">,
	projects: Project[],
): Pick<AppState, "selectedProjectId" | "activeProjectAreaId"> | Record<string, never> {
	const currentProjectId = selectActiveProjectAreaProjectId(state) ?? state.selectedProjectId;
	if (!currentProjectId || projects.some((project) => project.id === currentProjectId)) return {};
	return { selectedProjectId: projects[0]?.id ?? null, activeProjectAreaId: null };
}

export function projectSnapshot(state: AppState, projects: Project[], recentProjects: Project[]) {
	const openProjects = sortProjects(projects.filter((project) => project.closed !== true));
	return {
		projects: openProjects,
		recentProjects: sortProjects(recentProjects),
		...reconcileProjectNavigation(state, openProjects),
		...pruneExpandedProjects(state, openProjects),
	};
}

function isSessionDeleted(
	state: Pick<AppState, "deletedSessionsByProjectArea">,
	projectAreaId: string,
	sessionId: string,
): boolean {
	return state.deletedSessionsByProjectArea[projectAreaId]?.[sessionId] === true;
}

function patchDiffTab(
	state: Pick<AppState, "activeProjectAreaId" | "tabsByProjectArea">,
	id: string,
	patch: Partial<Omit<DiffTab, "kind" | "id">>,
): Partial<AppState> {
	const wsId = state.activeProjectAreaId;
	if (!wsId) return {};
	const tabs = state.tabsByProjectArea[wsId] ?? [];
	if (!tabs.some((t) => t.id === id && t.kind === "diff")) return {};
	return {
		tabsByProjectArea: {
			...state.tabsByProjectArea,
			[wsId]: tabs.map((t) => (t.id === id && t.kind === "diff" ? { ...t, ...patch } : t)),
		},
	};
}

function bumpNav(s: AppState, projectAreaId: string): Record<string, number> {
	return {
		...s.navTickByProjectArea,
		[projectAreaId]: selectProjectAreaNavTick(s, projectAreaId) + 1,
	};
}

function withoutChat(
	s: AppState,
	projectAreaId: string,
	sessionId: string,
	countNavigation: boolean,
	markDeleted = true,
): AppState {
	if (s.removedProjectAreaIds[projectAreaId]) return s;
	const alreadyDeleted = isSessionDeleted(s, projectAreaId, sessionId);
	const tabs = s.tabsByProjectArea[projectAreaId] ?? [];
	const sessionTabs = tabs.filter((candidate) => contentSessionId(candidate) === sessionId);
	const closed = s.closedChatsByProjectArea[projectAreaId] ?? [];
	const inHistory = closed.some((chat) => chat.sessionId === sessionId);
	const hasRuntime = s.sessions[sessionId] !== undefined;
	const hasSkillBaseline = Object.hasOwn(s.skillsSyncedTickBySession, sessionId);
	const targetsLocation =
		s.chatLocationRequest?.projectAreaId === projectAreaId &&
		s.chatLocationRequest.sessionId === sessionId;
	const targetsRoute =
		s.routeChatTarget?.projectAreaId === projectAreaId && s.routeChatTarget.sessionId === sessionId;
	const targetsHistory = s.historyOpenRequest?.sessionId === sessionId;
	if (
		alreadyDeleted &&
		sessionTabs.length === 0 &&
		!inHistory &&
		!hasRuntime &&
		!hasSkillBaseline &&
		!targetsLocation &&
		!targetsRoute &&
		!targetsHistory
	) {
		return s;
	}

	const removedTabIds = new Set(sessionTabs.map((candidate) => candidate.id));
	const remaining =
		sessionTabs.length > 0 ? tabs.filter((candidate) => !removedTabIds.has(candidate.id)) : tabs;
	const wasActive =
		s.activeTabByProjectArea[projectAreaId] !== null &&
		removedTabIds.has(s.activeTabByProjectArea[projectAreaId] ?? "");
	return {
		...s,
		...(markDeleted && !alreadyDeleted
			? {
					deletedSessionsByProjectArea: Object.assign(
						Object.create(null),
						s.deletedSessionsByProjectArea,
						{
							[projectAreaId]: Object.assign(
								Object.create(null),
								s.deletedSessionsByProjectArea[projectAreaId],
								{ [sessionId]: true as const },
							) as Record<string, true>,
						},
					) as Record<string, Record<string, true>>,
				}
			: {}),
		...(sessionTabs.length > 0
			? { tabsByProjectArea: { ...s.tabsByProjectArea, [projectAreaId]: remaining } }
			: {}),
		...(wasActive
			? {
					activeTabByProjectArea: {
						...s.activeTabByProjectArea,
						[projectAreaId]: remaining.at(-1)?.id ?? null,
					},
					navTickByProjectArea: countNavigation
						? bumpNav(s, projectAreaId)
						: s.navTickByProjectArea,
				}
			: {}),
		...(inHistory
			? {
					closedChatsByProjectArea: {
						...s.closedChatsByProjectArea,
						[projectAreaId]: closed.filter((chat) => chat.sessionId !== sessionId),
					},
				}
			: {}),
		...(hasRuntime ? { sessions: omitKey(s.sessions, sessionId) } : {}),
		...(hasSkillBaseline
			? { skillsSyncedTickBySession: omitKey(s.skillsSyncedTickBySession, sessionId) }
			: {}),
		...(targetsLocation ? { chatLocationRequest: null } : {}),
		...(targetsRoute ? { routeChatTarget: null } : {}),
		...(targetsHistory ? { historyOpenRequest: null } : {}),
	};
}

export const createWorkspaceState: StateCreator<AppState, [], [], WorkspaceState> = (set, get) => ({
	projects: [],
	recentProjects: [],
	projectAreas: {},
	removedProjectAreaIds: Object.create(null) as Record<string, true>,
	expandedProjectIds: Object.create(null) as Record<string, true>,
	selectedProjectId: null,
	activeProjectAreaId: null,
	routeChatTarget: null,
	routeChatTargetGeneration: 0,
	tabsByProjectArea: {},
	activeTabByProjectArea: {},
	previewTabByProjectArea: {},
	navTickByProjectArea: {},
	closedChatsByProjectArea: {},
	sessionCatalogVersionByProjectArea: {},
	deletedSessionsByProjectArea: Object.create(null) as Record<string, Record<string, true>>,
	activeActivityByProjectArea: {},
	changesRequest: null,
	changesView: "list",
	diffScopeByProjectArea: {},
	chatLocationRequest: null,
	historyOpenRequest: null,
	fsChangesByProjectArea: {},
	skillChangeTickByProjectArea: {},
	skillsSyncedTickBySession: {},
	commandCatalogGeneration: 0,
	installProjectSnapshot: (projects, recentProjects) =>
		set((state) => projectSnapshot(state, projects, recentProjects)),
	applyProjectUpdated: (project) =>
		set((state) => {
			const projects =
				project.closed === true
					? state.projects.filter((candidate) => candidate.id !== project.id)
					: sortProjects(upsertProject(state.projects, project));
			return {
				projects,
				recentProjects: sortProjects(upsertProject(state.recentProjects, project)),
				...reconcileProjectNavigation(state, projects),
				...pruneExpandedProjects(state, projects),
			};
		}),
	setProjectAreas: (projectId, projectAreas) =>
		set((s) => ({
			projectAreas: {
				...s.projectAreas,
				[projectId]: projectAreas.filter((projectArea) => !s.removedProjectAreaIds[projectArea.id]),
			},
		})),
	addProjectArea: (projectArea) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectArea.id]) return {};
			const list = s.projectAreas[projectArea.projectId];
			if (!list) return {};
			return {
				projectAreas: {
					...s.projectAreas,
					[projectArea.projectId]: list.some((w) => w.id === projectArea.id)
						? list.map((w) => (w.id === projectArea.id ? { ...w, ...projectArea } : w))
						: [...list, projectArea],
				},
			};
		}),
	updateProjectArea: (projectArea) =>
		set((s) => {
			const list = s.projectAreas[projectArea.projectId];
			if (!list?.some((w) => w.id === projectArea.id)) return {};
			return {
				projectAreas: {
					...s.projectAreas,
					[projectArea.projectId]: list.map((w) => (w.id === projectArea.id ? projectArea : w)),
				},
			};
		}),
	removeProjectArea: (projectId, projectAreaId) =>
		set((s) => {
			const list = s.projectAreas[projectId];
			if (!list) return {};
			return {
				projectAreas: {
					...s.projectAreas,
					[projectId]: list.filter((w) => w.id !== projectAreaId),
				},
			};
		}),
	applyProjectAreaRemoved: (projectId, projectAreaId) => {
		const s = get();
		const wasActive = s.activeProjectAreaId === projectAreaId;
		const name = s.projectAreas[projectId]?.find((w) => w.id === projectAreaId)?.name;
		set((state) => {
			const removedSessions = new Set(selectProjectAreaSessionIds(state, projectAreaId));
			return {
				removedProjectAreaIds: Object.assign(Object.create(null), state.removedProjectAreaIds, {
					[projectAreaId]: true,
				}) as Record<string, true>,
				fsChangesByProjectArea: omitKey(state.fsChangesByProjectArea, projectAreaId),
				skillChangeTickByProjectArea: omitKey(state.skillChangeTickByProjectArea, projectAreaId),
				sessionCatalogVersionByProjectArea: omitKey(
					state.sessionCatalogVersionByProjectArea,
					projectAreaId,
				),
				diffScopeByProjectArea: omitKey(state.diffScopeByProjectArea, projectAreaId),
				changesRequest:
					state.changesRequest?.projectAreaId === projectAreaId ? null : state.changesRequest,
				chatLocationRequest:
					state.chatLocationRequest?.projectAreaId === projectAreaId
						? null
						: state.chatLocationRequest,
				routeChatTarget:
					state.routeChatTarget?.projectAreaId === projectAreaId ? null : state.routeChatTarget,
				historyOpenRequest:
					state.historyOpenRequest && removedSessions.has(state.historyOpenRequest.sessionId)
						? null
						: state.historyOpenRequest,
			};
		});
		s.removeProjectArea(projectId, projectAreaId);
		s.clearProjectAreaTabs(projectAreaId);
		if (wasActive) {
			s.selectProject(projectId);
			get().pushToast({ variant: "info", message: `ProjectArea "${name ?? "?"}" was removed` });
		}
	},
	selectProject: (selectedProjectId, opts) =>
		set((state) => ({
			selectedProjectId,
			activeProjectAreaId: null,
			...(opts?.reveal
				? { expandedProjectIds: withExpandedProject(state.expandedProjectIds, selectedProjectId) }
				: {}),
		})),
	toggleProjectExpanded: (projectId) =>
		set((state) => ({
			expandedProjectIds: state.expandedProjectIds[projectId]
				? omitKey(state.expandedProjectIds, projectId)
				: withExpandedProject(state.expandedProjectIds, projectId),
		})),
	expandProject: (projectId) =>
		set((state) => {
			const expandedProjectIds = withExpandedProject(state.expandedProjectIds, projectId);
			return expandedProjectIds === state.expandedProjectIds ? {} : { expandedProjectIds };
		}),
	hydrateExpandedProjects: (projectIds) =>
		set(() => ({
			expandedProjectIds: Object.fromEntries(projectIds.map((id) => [id, true as const])),
		})),
	selectMain: () =>
		set({ selectedProjectId: null, activeProjectAreaId: null, routeChatTarget: null }),
	activateProjectArea: (projectArea) =>
		set((state) =>
			state.removedProjectAreaIds[projectArea.id]
				? {}
				: { selectedProjectId: projectArea.projectId, activeProjectAreaId: projectArea.id },
		),
	activateProjectAreaFromRoute: (projectArea, sessionId) =>
		set((state) => {
			if (state.removedProjectAreaIds[projectArea.id]) return {};
			return {
				selectedProjectId: projectArea.projectId,
				activeProjectAreaId: projectArea.id,
				navTickByProjectArea: sessionId
					? {
							...state.navTickByProjectArea,
							[projectArea.id]: selectProjectAreaNavTick(state, projectArea.id) + 1,
						}
					: state.navTickByProjectArea,
				routeChatTarget: sessionId
					? {
							projectAreaId: projectArea.id,
							sessionId,
							navTick: selectProjectAreaNavTick(state, projectArea.id) + 1,
							validated: false,
						}
					: null,
				routeChatTargetGeneration: sessionId
					? state.routeChatTargetGeneration + 1
					: state.routeChatTargetGeneration,
			};
		}),
	validateRouteChatTarget: (sessionId) =>
		set((state) => {
			const target = state.routeChatTarget;
			if (!target || target.sessionId !== sessionId || target.validated) return state;
			return { routeChatTarget: { ...target, validated: true } };
		}),
	clearRouteChatTarget: () =>
		set((state) => (state.routeChatTarget ? { routeChatTarget: null } : state)),
	openTab: (tab, intent, options = {}) =>
		set((s) => {
			const wsId = tab.projectAreaId;
			const sessionId = contentSessionId(tab);
			if (
				s.removedProjectAreaIds[wsId] ||
				(sessionId !== null && isSessionDeleted(s, wsId, sessionId))
			) {
				return {};
			}
			const tabs = s.tabsByProjectArea[wsId] ?? [];
			const resolvedId = availableContentTabId(tabs, tab);
			const resolvedTab = resolvedId === tab.id ? tab : { ...tab, id: resolvedId };
			const previewCompatible = resolvedTab.kind === "file" || resolvedTab.kind === "diff";
			const effectiveIntent = previewCompatible ? intent : "keep";
			const claimPreview = previewCompatible && options.claimPreview === true;
			const preview = s.previewTabByProjectArea[wsId];
			const activeTabByProjectArea =
				options.activate === false
					? s.activeTabByProjectArea
					: { ...s.activeTabByProjectArea, [wsId]: resolvedTab.id };
			const existingIndex = tabs.findIndex((candidate) => candidate.id === resolvedTab.id);
			if (existingIndex >= 0) {
				const existing = tabs[existingIndex];
				return {
					tabsByProjectArea:
						existing === resolvedTab
							? s.tabsByProjectArea
							: { ...s.tabsByProjectArea, [wsId]: tabs.with(existingIndex, resolvedTab) },
					activeTabByProjectArea,
					previewTabByProjectArea:
						effectiveIntent === "keep" &&
						(preview === resolvedTab.id || (claimPreview && preview !== undefined))
							? omitKey(s.previewTabByProjectArea, wsId)
							: s.previewTabByProjectArea,
				};
			}
			const at =
				(effectiveIntent === "preview" || claimPreview) && preview
					? tabs.findIndex((t) => t.id === preview)
					: -1;
			return {
				tabsByProjectArea: {
					...s.tabsByProjectArea,
					[wsId]: at === -1 ? [...tabs, resolvedTab] : tabs.with(at, resolvedTab),
				},
				activeTabByProjectArea,
				previewTabByProjectArea:
					effectiveIntent === "preview"
						? { ...s.previewTabByProjectArea, [wsId]: resolvedTab.id }
						: claimPreview && preview
							? omitKey(s.previewTabByProjectArea, wsId)
							: s.previewTabByProjectArea,
			};
		}),
	closeTab: (id, countNavigation = true, projectAreaId) =>
		set((s) => {
			const wsId = projectAreaId ?? s.activeProjectAreaId;
			if (!wsId || s.removedProjectAreaIds[wsId]) return {};
			const tabs = (s.tabsByProjectArea[wsId] ?? []).filter((t) => t.id !== id);
			const wasActive = s.activeTabByProjectArea[wsId] === id;
			return {
				tabsByProjectArea: { ...s.tabsByProjectArea, [wsId]: tabs },
				activeTabByProjectArea: {
					...s.activeTabByProjectArea,
					[wsId]: wasActive ? (tabs.at(-1)?.id ?? null) : (s.activeTabByProjectArea[wsId] ?? null),
				},
				navTickByProjectArea:
					wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByProjectArea,
				...(s.previewTabByProjectArea[wsId] === id
					? { previewTabByProjectArea: omitKey(s.previewTabByProjectArea, wsId) }
					: {}),
			};
		}),
	setActiveTab: (id, intent) =>
		set((s) => {
			const wsId = s.activeProjectAreaId;
			if (!wsId) return {};
			return {
				activeTabByProjectArea: { ...s.activeTabByProjectArea, [wsId]: id },
				navTickByProjectArea: bumpNav(s, wsId),
				...(intent === "keep" && s.previewTabByProjectArea[wsId] === id
					? { previewTabByProjectArea: omitKey(s.previewTabByProjectArea, wsId) }
					: {}),
			};
		}),
	noteNavigation: (projectAreaId) =>
		set((s) =>
			s.removedProjectAreaIds[projectAreaId]
				? {}
				: { navTickByProjectArea: bumpNav(s, projectAreaId) },
		),
	setFileTabView: (id, view) =>
		set((s) => {
			const wsId = s.activeProjectAreaId;
			if (!wsId) return {};
			const tabs = s.tabsByProjectArea[wsId] ?? [];
			if (!tabs.some((t) => t.id === id && t.kind === "file")) return {};
			return {
				tabsByProjectArea: {
					...s.tabsByProjectArea,
					[wsId]: tabs.map((t) => (t.id === id && t.kind === "file" ? { ...t, view } : t)),
				},
			};
		}),
	setDiffTabIgnoreWhitespace: (id, ignoreWhitespace) =>
		set((s) => patchDiffTab(s, id, { ignoreWhitespace })),
	setChangesView: (view) => set({ changesView: view }),
	setDiffScope: (projectAreaId, scope) =>
		set((s) =>
			s.removedProjectAreaIds[projectAreaId]
				? {}
				: { diffScopeByProjectArea: { ...s.diffScopeByProjectArea, [projectAreaId]: scope } },
		),
	noteDiffComparison: (projectAreaId, repository, scope, comparisonId) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId] || scope.kind !== "branch" || comparisonId === "")
				return {};
			const tabs = s.tabsByProjectArea[projectAreaId] ?? [];
			if (
				!tabs.some(
					(tab) =>
						tab.kind === "diff" &&
						tab.repository === repository &&
						tab.scope.kind === "branch" &&
						tab.scope.baseRef === scope.baseRef &&
						tab.targetComparison !== comparisonId,
				)
			)
				return {};
			return {
				tabsByProjectArea: {
					...s.tabsByProjectArea,
					[projectAreaId]: tabs.map((tab) =>
						tab.kind === "diff" &&
						tab.repository === repository &&
						tab.scope.kind === "branch" &&
						tab.scope.baseRef === scope.baseRef
							? { ...tab, targetComparison: comparisonId }
							: tab,
					),
				},
			};
		}),
	noteFsChanged: (payload) =>
		set((s) => {
			if (s.removedProjectAreaIds[payload.projectId]) return {};
			const prev = s.fsChangesByProjectArea[payload.projectId];
			const tick = (prev?.tick ?? 0) + 1;
			const skillChanged =
				payload.truncated || payload.changes.some(({ path }) => /(^|\/)SKILL\.md$/.test(path));
			return {
				fsChangesByProjectArea: {
					...s.fsChangesByProjectArea,
					[payload.projectId]: {
						tick,
						changes: payload.changes,
						truncated: payload.truncated,
					},
				},
				...(skillChanged
					? {
							skillChangeTickByProjectArea: {
								...s.skillChangeTickByProjectArea,
								[payload.projectId]: tick,
							},
						}
					: {}),
			};
		}),
	markSkillsSynced: (sessionId, syncedTick) =>
		set((s) => {
			if (!s.sessions[sessionId]) return {};
			const synced = Math.max(s.skillsSyncedTickBySession[sessionId] ?? 0, syncedTick);
			return {
				skillsSyncedTickBySession: { ...s.skillsSyncedTickBySession, [sessionId]: synced },
			};
		}),
	noteCommandCatalogChanged: () =>
		set((s) => ({ commandCatalogGeneration: s.commandCatalogGeneration + 1 })),
	updateFileTabContent: (projectAreaId, id, content, tick) =>
		set((state) => {
			if (state.removedProjectAreaIds[projectAreaId]) return {};
			const tabs = state.tabsByProjectArea[projectAreaId] ?? [];
			if (!tabs.some((tab) => tab.id === id && tab.kind === "file")) return {};
			return {
				tabsByProjectArea: {
					...state.tabsByProjectArea,
					[projectAreaId]: tabs.map((tab) =>
						tab.id === id && tab.kind === "file" ? { ...tab, content, loadedTick: tick } : tab,
					),
				},
			};
		}),
	updateDiffTabContent: (projectAreaId, id, preview, tick, loadedTarget) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId]) return {};
			const tabs = s.tabsByProjectArea[projectAreaId] ?? [];
			if (!tabs.some((tab) => tab.id === id && tab.kind === "diff")) return {};
			return {
				tabsByProjectArea: {
					...s.tabsByProjectArea,
					[projectAreaId]: tabs.map((tab) => {
						if (tab.id !== id || tab.kind !== "diff") return tab;
						const next: DiffTab = {
							...tab,
							original: preview.original,
							modified: preview.modified,
							loadedTick: tick,
							loadedTarget: preview.comparisonId ?? loadedTarget,
							...(tab.scope.kind === "branch" && preview.comparisonId
								? { targetComparison: preview.comparisonId }
								: {}),
						};
						// Clear optional fields that are absent from the latest preview.
						for (const key of [
							"originalPath",
							"comparisonId",
							"unavailable",
							"binary",
							"tooLarge",
							"message",
						] as const) {
							if (preview[key] === undefined) delete next[key];
							else Object.assign(next, { [key]: preview[key] });
						}
						return next;
					}),
				},
			};
		}),
	clearProjectAreaTabs: (projectAreaId) =>
		set((s) => {
			const sessions = { ...s.sessions };
			const skillsSyncedTickBySession = { ...s.skillsSyncedTickBySession };
			for (const sessionId of selectProjectAreaSessionIds(s, projectAreaId)) {
				delete sessions[sessionId];
				delete skillsSyncedTickBySession[sessionId];
			}
			return {
				tabsByProjectArea: omitKey(s.tabsByProjectArea, projectAreaId),
				activeTabByProjectArea: omitKey(s.activeTabByProjectArea, projectAreaId),
				previewTabByProjectArea: omitKey(s.previewTabByProjectArea, projectAreaId),
				navTickByProjectArea: omitKey(s.navTickByProjectArea, projectAreaId),
				closedChatsByProjectArea: omitKey(s.closedChatsByProjectArea, projectAreaId),
				sessionCatalogVersionByProjectArea: omitKey(
					s.sessionCatalogVersionByProjectArea,
					projectAreaId,
				),
				activeActivityByProjectArea: omitKey(s.activeActivityByProjectArea, projectAreaId),
				sessions,
				skillsSyncedTickBySession,
			};
		}),
	setActiveActivity: (projectAreaId, activity) =>
		set((s) =>
			s.removedProjectAreaIds[projectAreaId]
				? {}
				: {
						activeActivityByProjectArea: {
							...s.activeActivityByProjectArea,
							[projectAreaId]: activity,
						},
					},
		),
	openChatSession: (
		projectAreaId,
		sessionId,
		model,
		thinkingLevel,
		modes = null,
		syncedTick,
		options = {},
	) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId] || isSessionDeleted(s, projectAreaId, sessionId)) {
				return {};
			}
			const tabs = s.tabsByProjectArea[projectAreaId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === sessionId,
			);
			const preferred: ChatTab = existing ?? {
				kind: "chat",
				id: chatTabId(projectAreaId, sessionId),
				projectAreaId,
				name: "Chat",
				sessionId,
			};
			const id = existing?.id ?? availableContentTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			const fresh = !s.sessions[sessionId];
			return {
				tabsByProjectArea: existing
					? s.tabsByProjectArea
					: { ...s.tabsByProjectArea, [projectAreaId]: [...tabs, tab] },
				activeTabByProjectArea:
					options.activate === false
						? s.activeTabByProjectArea
						: { ...s.activeTabByProjectArea, [projectAreaId]: id },
				navTickByProjectArea:
					options.activate === false ? s.navTickByProjectArea : bumpNav(s, projectAreaId),
				sessions: fresh
					? { ...s.sessions, [sessionId]: createSessionRuntime(model, thinkingLevel, modes) }
					: s.sessions,
				...(fresh
					? {
							skillsSyncedTickBySession: {
								...s.skillsSyncedTickBySession,
								[sessionId]: syncedTick ?? selectProjectAreaTick(s, projectAreaId),
							},
						}
					: {}),
			};
		}),
	closeChatRuntime: (sessionId) =>
		set((s) => {
			if (!s.sessions[sessionId]) return {};
			return {
				sessions: omitKey(s.sessions, sessionId),
				skillsSyncedTickBySession: omitKey(s.skillsSyncedTickBySession, sessionId),
			};
		}),
	closeChatToHistory: (sessionId, projectAreaId, countNavigation = true) =>
		set((s) => {
			const wsId = projectAreaId ?? s.activeProjectAreaId;
			if (!wsId || s.removedProjectAreaIds[wsId]) return {};
			const tabs = s.tabsByProjectArea[wsId] ?? [];
			const tab = tabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
			if (!tab) return {};
			const remaining = tabs.filter((t) => t.id !== tab.id);
			const wasActive = s.activeTabByProjectArea[wsId] === tab.id;
			const entry: ClosedChat = { sessionId, title: tab.name, closedAt: Date.now() };
			const targetsLocation =
				s.chatLocationRequest?.projectAreaId === wsId &&
				s.chatLocationRequest.sessionId === sessionId;
			const targetsHistory = s.historyOpenRequest?.sessionId === sessionId;
			const runtime = s.sessions[sessionId];
			const hasAnotherTab = Object.entries(s.tabsByProjectArea).some(([areaId, areaTabs]) =>
				areaTabs.some(
					(candidate) =>
						candidate.kind === "chat" &&
						candidate.sessionId === sessionId &&
						(areaId !== wsId || candidate.id !== tab.id),
				),
			);
			const canDropRuntime =
				runtime !== undefined &&
				!hasAnotherTab &&
				!runtime.isStreaming &&
				runtime.queue.steering.length === 0 &&
				runtime.queue.followUp.length === 0 &&
				runtime.pendingExtUi === null &&
				runtime.extUiQueue.length === 0 &&
				runtime.goal.status !== "loading" &&
				runtime.goal.status !== "saving" &&
				Object.keys(s.pendingPermissions[sessionId] ?? {}).length === 0;
			return {
				tabsByProjectArea: { ...s.tabsByProjectArea, [wsId]: remaining },
				navTickByProjectArea:
					wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByProjectArea,
				activeTabByProjectArea: {
					...s.activeTabByProjectArea,
					[wsId]: wasActive
						? (remaining.at(-1)?.id ?? null)
						: (s.activeTabByProjectArea[wsId] ?? null),
				},
				closedChatsByProjectArea: {
					...s.closedChatsByProjectArea,
					[wsId]: [entry, ...(s.closedChatsByProjectArea[wsId] ?? [])],
				},
				...(canDropRuntime
					? {
							sessions: omitKey(s.sessions, sessionId),
							skillsSyncedTickBySession: omitKey(s.skillsSyncedTickBySession, sessionId),
						}
					: {}),
				...(targetsLocation ? { chatLocationRequest: null } : {}),
				...(targetsHistory ? { historyOpenRequest: null } : {}),
			};
		}),
	deleteChat: (projectAreaId, sessionId, countNavigation = true) =>
		set((s) => withoutChat(s, projectAreaId, sessionId, countNavigation)),
	applySessionLifecycle: (payload) =>
		set((s) => {
			if (s.removedProjectAreaIds[payload.projectId]) return {};
			const version = (s.sessionCatalogVersionByProjectArea[payload.projectId] ?? 0) + 1;
			const versionPatch = {
				sessionCatalogVersionByProjectArea: {
					...s.sessionCatalogVersionByProjectArea,
					[payload.projectId]: version,
				},
			};
			if (payload.operation === "renamed" && payload.title) {
				const tabs = s.tabsByProjectArea[payload.projectId] ?? [];
				const closed = s.closedChatsByProjectArea[payload.projectId] ?? [];
				return {
					...versionPatch,
					tabsByProjectArea: {
						...s.tabsByProjectArea,
						[payload.projectId]: tabs.map((tab) =>
							tab.kind === "chat" && tab.sessionId === payload.sessionId
								? { ...tab, name: payload.title as string }
								: tab,
						),
					},
					closedChatsByProjectArea: {
						...s.closedChatsByProjectArea,
						[payload.projectId]: closed.map((chat) =>
							chat.sessionId === payload.sessionId
								? { ...chat, title: payload.title as string }
								: chat,
						),
					},
				};
			}
			if (payload.operation === "archived") {
				const next = withoutChat(s, payload.projectId, payload.sessionId, false, false);
				return {
					...next,
					...versionPatch,
					pendingPermissions: omitKey(next.pendingPermissions, payload.sessionId),
				};
			}
			return versionPatch;
		}),
	reconcileProjectAreaSessions: (projectAreaId, baselineSessionIds, authoritativeSessions) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId]) return {};
			const active = new Map(
				authoritativeSessions
					.filter((session) => !session.archived)
					.map((session) => [session.sessionId, session.title]),
			);
			const archived = new Set(
				authoritativeSessions
					.filter((session) => session.archived)
					.map((session) => session.sessionId),
			);
			const queues = new Map(
				authoritativeSessions
					.filter((session) => session.queue !== undefined)
					.map((session) => [session.sessionId, session.queue as SessionQueueState]),
			);
			const tabs = s.tabsByProjectArea[projectAreaId] ?? [];
			const closed = s.closedChatsByProjectArea[projectAreaId] ?? [];
			let next: AppState = {
				...s,
				tabsByProjectArea: {
					...s.tabsByProjectArea,
					[projectAreaId]: tabs.map((tab) => {
						if (tab.kind !== "chat") return tab;
						const title = active.get(tab.sessionId);
						return title !== undefined && title !== tab.name ? { ...tab, name: title } : tab;
					}),
				},
				closedChatsByProjectArea: {
					...s.closedChatsByProjectArea,
					[projectAreaId]: closed.map((chat) => {
						const title = active.get(chat.sessionId);
						return title !== undefined && title !== chat.title ? { ...chat, title } : chat;
					}),
				},
				sessions: Object.fromEntries(
					Object.entries(s.sessions).map(([sessionId, runtime]) => {
						const queue = queues.get(sessionId);
						return [sessionId, queue ? { ...runtime, queue } : runtime];
					}),
				),
			};
			for (const sessionId of baselineSessionIds) {
				if (!active.has(sessionId)) {
					next = withoutChat(next, projectAreaId, sessionId, false, !archived.has(sessionId));
				}
			}
			return next;
		}),
	reopenChat: (wsId, sessionId, options = {}) =>
		set((s) => {
			if (s.removedProjectAreaIds[wsId] || isSessionDeleted(s, wsId, sessionId)) return {};
			const closed = s.closedChatsByProjectArea[wsId] ?? [];
			const entry = closed.find((c) => c.sessionId === sessionId);
			if (!entry) return {};
			const tabs = s.tabsByProjectArea[wsId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === sessionId,
			);
			const preferred: ChatTab = {
				kind: "chat",
				id: existing?.id ?? chatTabId(wsId, sessionId),
				projectAreaId: wsId,
				name: entry.title,
				sessionId,
			};
			const id = existing?.id ?? availableContentTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			return {
				tabsByProjectArea: existing
					? existing.name === tab.name
						? s.tabsByProjectArea
						: {
								...s.tabsByProjectArea,
								[wsId]: tabs.map((candidate) => (candidate === existing ? tab : candidate)),
							}
					: { ...s.tabsByProjectArea, [wsId]: [...tabs, tab] },
				activeTabByProjectArea:
					options.activate === false
						? s.activeTabByProjectArea
						: { ...s.activeTabByProjectArea, [wsId]: id },
				navTickByProjectArea:
					options.activate === false ? s.navTickByProjectArea : bumpNav(s, wsId),
				closedChatsByProjectArea: {
					...s.closedChatsByProjectArea,
					[wsId]: closed.filter((c) => c.sessionId !== sessionId),
				},
			};
		}),
	noteClosedChats: (projectAreaId, entries) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId]) return {};
			const existing = s.closedChatsByProjectArea[projectAreaId] ?? [];
			const known = new Set([
				...existing.map((c) => c.sessionId),
				...(s.tabsByProjectArea[projectAreaId] ?? [])
					.filter((t): t is ChatTab => t.kind === "chat")
					.map((t) => t.sessionId),
			]);
			const fresh = entries.filter(
				(e) =>
					!isSessionDeleted(s, projectAreaId, e.sessionId) &&
					!known.has(e.sessionId) &&
					!s.sessions[e.sessionId],
			);
			if (fresh.length === 0) return {};
			return {
				closedChatsByProjectArea: {
					...s.closedChatsByProjectArea,
					[projectAreaId]: [...existing, ...fresh].sort((a, b) => b.closedAt - a.closedAt),
				},
			};
		}),
	hydrateSession: (
		summary,
		hydrated,
		modes,
		planState,
		activate = false,
		syncedTick,
		options = {},
	) =>
		set((s) => {
			if (
				s.removedProjectAreaIds[summary.projectId] ||
				isSessionDeleted(s, summary.projectId, summary.sessionId)
			) {
				return {};
			}
			if (s.sessions[summary.sessionId]) return {};
			const wsId = summary.projectId;
			const runtime: SessionRuntime = {
				...createSessionRuntime(summary.model, summary.thinkingLevel, modes),
				planState,
				...(summary.parentSessionId ? { parentSessionId: summary.parentSessionId } : {}),
				turns: hydrated.turns,
				toolResults: hydrated.toolResults,
				askAnswers: hydrated.askAnswers,
				turnIdByMessageIndex: hydrated.turnIdByMessageIndex,
				transcript: hydrated.transcript,
				currentAssistantId: hydrated.currentAssistantId,
				isStreaming: summary.isStreaming,
				...(summary.queue ? { queue: summary.queue } : {}),
			};
			const tabs = s.tabsByProjectArea[wsId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === summary.sessionId,
			);
			const preferred: ChatTab = {
				kind: "chat",
				id: existing?.id ?? chatTabId(wsId, summary.sessionId),
				projectAreaId: wsId,
				name: summary.title,
				sessionId: summary.sessionId,
			};
			const id = existing?.id ?? availableContentTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			const hasActive = s.activeTabByProjectArea[wsId] != null;
			const takesFocus = options.activate !== false && (activate || !hasActive);
			const closed = s.closedChatsByProjectArea[wsId] ?? [];
			return {
				sessions: { ...s.sessions, [summary.sessionId]: runtime },
				...(syncedTick !== undefined
					? {
							skillsSyncedTickBySession: {
								...s.skillsSyncedTickBySession,
								[summary.sessionId]: syncedTick,
							},
						}
					: {}),
				tabsByProjectArea: existing
					? existing.name === tab.name
						? s.tabsByProjectArea
						: {
								...s.tabsByProjectArea,
								[wsId]: tabs.map((candidate) => (candidate === existing ? tab : candidate)),
							}
					: { ...s.tabsByProjectArea, [wsId]: [...tabs, tab] },
				activeTabByProjectArea: takesFocus
					? { ...s.activeTabByProjectArea, [wsId]: id }
					: s.activeTabByProjectArea,
				navTickByProjectArea: takesFocus ? bumpNav(s, wsId) : s.navTickByProjectArea,
				closedChatsByProjectArea: closed.some((c) => c.sessionId === summary.sessionId)
					? {
							...s.closedChatsByProjectArea,
							[wsId]: closed.filter((c) => c.sessionId !== summary.sessionId),
						}
					: s.closedChatsByProjectArea,
			};
		}),
	requestToolView: (projectAreaId, tool) =>
		set((state) =>
			state.removedProjectAreaIds[projectAreaId]
				? {}
				: {
						activeActivityByProjectArea: {
							...state.activeActivityByProjectArea,
							[projectAreaId]: tool === "changes" ? "changes" : "files",
						},
					},
		),
	requestChangesView: (projectAreaId, path) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId]) return {};
			return {
				activeActivityByProjectArea: {
					...s.activeActivityByProjectArea,
					[projectAreaId]: "changes",
				},
				changesRequest: {
					projectAreaId,
					path,
					navTick: selectProjectAreaNavTick(s, projectAreaId) + 1,
				},
			};
		}),
	clearChangesRequest: () => set({ changesRequest: null }),
	requestChatLocation: (req) =>
		set((state) => {
			if (
				state.removedProjectAreaIds[req.projectAreaId] ||
				isSessionDeleted(state, req.projectAreaId, req.sessionId)
			) {
				return {};
			}
			return {
				chatLocationRequest: req,
				selectedProjectId: req.projectId,
				activeProjectAreaId: req.projectAreaId,
			};
		}),
	clearChatLocation: () => set({ chatLocationRequest: null }),
	requestHistoryOpen: (target) =>
		set((s) => {
			if (
				s.removedProjectAreaIds[target.projectAreaId] ||
				isSessionDeleted(s, target.projectAreaId, target.sessionId)
			) {
				return {};
			}
			const cache = s.tabsByProjectArea[target.projectAreaId]?.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === target.sessionId,
			);
			const historyRequestId = randomId("history-open");
			return {
				historyOpenRequest: { id: historyRequestId, sessionId: target.sessionId },
				activeTabByProjectArea: cache
					? { ...s.activeTabByProjectArea, [target.projectAreaId]: cache.id }
					: s.activeTabByProjectArea,
			};
		}),
	clearHistoryOpen: () => set({ historyOpenRequest: null }),
});
