import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiRequest,
	GitDiffScope,
	LoginFrame,
	LoginPush,
	PiEvent,
	Project,
	ProjectFsChangedPayload,
	RefreshedModels,
	SessionGoal,
	SessionQueueState,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	UserMessage,
	WireModel,
} from "@mewa-code/contracts";
import { DEFAULT_CONFIG, isAskUserAnswersMessage } from "@mewa-code/contracts";
import { create } from "zustand";
import type { LoginState } from "../auth";
import { assistantFailureText } from "../chat/assistant-failure";
import type { HydratedRuntime } from "../chat/hydrate";
import type {
	ChatAttachment,
	ChatTurn,
	CompactionState,
	ExtUiDialogRequest,
	ToolResultState,
} from "../chat/types";
import {
	matchesSkillInvocationCommand,
	parseSkillInvocation,
	randomId,
	tupleKey,
	userText,
} from "../lib";
import type { ConnectionStatus } from "../transport";
import {
	type HistoryTarget,
	selectActiveProjectAreaProjectId,
	selectProjectAreaNavTick,
	selectProjectAreaSessionIds,
	selectProjectAreaTick,
} from "./selectors";

/** Transitional view identity: one UI work area per directory-based project. */
export interface ProjectArea {
	id: string;
	projectId: string;
	name: string;
	root: string;
	kind: "project";
}

export function projectArea(project: Project, selectedRoot = project.roots[0] ?? ""): ProjectArea {
	const root = project.roots.includes(selectedRoot) ? selectedRoot : (project.roots[0] ?? "");
	return {
		id: project.id,
		projectId: project.id,
		name: project.name,
		root,
		kind: "project",
	};
}

export interface FileTab {
	kind: "file";
	id: string;
	projectAreaId: string;
	root: string;
	name: string;
	path: string;
	content: string;
	view?: "rendered" | "source";
	loadedTick?: number;
}
export interface ChatTab {
	kind: "chat";
	id: string;
	projectAreaId: string;
	name: string;
	sessionId: string;
}
export interface DiffTab {
	kind: "diff";
	id: string;
	projectAreaId: string;
	repository: string;
	name: string;
	path: string;
	scope: GitDiffScope;
	loadedTarget: string;
	original: string;
	modified: string;
	ignoreWhitespace?: boolean;
	loadedTick?: number;
}
export type ContentTab = FileTab | ChatTab | DiffTab;
export type ProjectAreaActivity = "files" | "changes";

export function chatTabId(projectAreaId: string, sessionId: string): string {
	return tupleKey("chat", projectAreaId, sessionId);
}

function contentResourceIdentity(tab: ContentTab): string {
	if (tab.kind === "file") return tupleKey("content-resource", "file", tab.path);
	if (tab.kind === "diff") {
		const reference =
			tab.scope.kind === "commit"
				? tab.scope.sha
				: tab.scope.kind === "pinned"
					? tab.scope.baseRef
					: "";
		return tupleKey("content-resource", "diff", tab.path, tab.scope.kind, reference);
	}
	return tupleKey("content-resource", "chat", tab.sessionId);
}

function contentSessionId(tab: ContentTab): string | null {
	return tab.kind === "chat" ? tab.sessionId : null;
}

function availableContentTabId(tabs: readonly ContentTab[], tab: ContentTab): string {
	const identity = contentResourceIdentity(tab);
	const existing = tabs.find((candidate) => contentResourceIdentity(candidate) === identity);
	if (existing) return existing.id;
	if (!tabs.some((candidate) => candidate.id === tab.id)) return tab.id;
	let fallback = randomId("content-cache");
	while (tabs.some((candidate) => candidate.id === fallback)) fallback = randomId("content-cache");
	return fallback;
}

export type TabIntent = "preview" | "keep";

export interface RouteChatTarget {
	projectAreaId: string;
	sessionId: string;
	navTick: number;
	validated: boolean;
}

export interface ContentOpenOptions {
	activate?: boolean;
	claimPreview?: boolean;
}

export const SettingsSection = {
	Providers: "providers",
	Models: "models",
	Signet: "signet",
} as const;
export type SettingsSection = (typeof SettingsSection)[keyof typeof SettingsSection];

export interface Toast {
	id: string;
	variant: "error" | "success" | "info";
	message: string;
	title?: string;
}

const MAX_TOASTS = 5;

export interface ClosedChat {
	sessionId: string;
	title: string;
	closedAt: number;
}

export interface ChatLocationRequest {
	projectAreaId: string;
	projectId: string;
	sessionId: string;
	messageIndex: number;
	anchorText: string;
}

export interface SessionRuntime {
	turns: ChatTurn[];
	turnIdByMessageIndex?: (string | null)[];
	toolResults: Record<string, ToolResultState>;
	askAnswers: Record<string, AskUserQuestionResult>;
	currentAssistantId: string | null;
	attemptAssistantId: string | null;
	isStreaming: boolean;
	queue: SessionQueueState;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	stats: SessionStats | null;
	commands: SlashCommandInfo[];
	draft: string;
	pendingExtUi: ExtUiDialogRequest | null;
	extUiQueue: ExtUiDialogRequest[];
	extUiStatus: Record<string, string>;
	extUiWidget: Record<string, string[]>;
	goal: SessionGoalRuntime;
}

export interface SessionGoalRuntime {
	projectAreaId: string | null;
	status: "idle" | "loading" | "saving" | "ready" | "error";
	goal: string | null;
	tasks: SessionGoal["tasks"];
	updatedAt: number | null;
	error: string | null;
}

const EMPTY_QUEUE: SessionQueueState = { steering: [], followUp: [] };

function newRuntime(model: WireModel | null, thinkingLevel: ThinkingLevel): SessionRuntime {
	return {
		turns: [],
		toolResults: {},
		askAnswers: {},
		currentAssistantId: null,
		attemptAssistantId: null,
		isStreaming: false,
		queue: EMPTY_QUEUE,
		model,
		thinkingLevel,
		stats: null,
		commands: [],
		draft: "",
		pendingExtUi: null,
		extUiQueue: [],
		extUiStatus: {},
		extUiWidget: {},
		goal: {
			projectAreaId: null,
			status: "idle",
			goal: null,
			tasks: [],
			updatedAt: null,
			error: null,
		},
	};
}

export const EMPTY_RUNTIME: SessionRuntime = newRuntime(null, "medium");

function clearTurnStreaming(turns: ChatTurn[]): ChatTurn[] {
	if (!turns.some((t) => t.kind === "assistant" && t.streaming)) return turns;
	return turns.map((t) => (t.kind === "assistant" && t.streaming ? { ...t, streaming: false } : t));
}

function removeSupersededAssistant(
	turns: ChatTurn[],
	attemptAssistantId: string | null,
): ChatTurn[] {
	if (!attemptAssistantId) return turns;
	const index = turns.findIndex(
		(turn) =>
			turn.id === attemptAssistantId &&
			turn.kind === "assistant" &&
			assistantFailureText(turn.message) !== null,
	);
	return index < 0 ? turns : [...turns.slice(0, index), ...turns.slice(index + 1)];
}

function compactionOutcome(event: Extract<PiEvent, { type: "compaction_end" }>): CompactionState {
	if (event.aborted) return { status: "cancelled" };
	if (event.errorMessage) return { status: "failed", detail: event.errorMessage };
	const tokensBefore = event.result?.tokensBefore;
	const tokensAfter = event.result?.estimatedTokensAfter;
	return {
		status: "done",
		...(typeof tokensBefore === "number" ? { tokensBefore } : {}),
		...(typeof tokensAfter === "number" ? { tokensAfter } : {}),
		...(event.willRetry ? { resuming: true } : {}),
	};
}

function clearCompactionResuming(turns: ChatTurn[]): ChatTurn[] {
	if (!turns.some((t) => t.kind === "compaction" && t.resuming)) return turns;
	return turns.map((t) => {
		if (t.kind !== "compaction" || !t.resuming) return t;
		const { resuming, ...rest } = t;
		return rest;
	});
}

function settleCompactionTurn(
	turns: ChatTurn[],
	event: Extract<PiEvent, { type: "compaction_end" }>,
): ChatTurn[] {
	const outcome = compactionOutcome(event);
	const index = turns.findLastIndex((t) => t.kind === "compaction" && t.status === "running");
	if (index < 0) return [...turns, { kind: "compaction", id: crypto.randomUUID(), ...outcome }];
	return turns.map((t, i) => (i === index ? { kind: "compaction", id: t.id, ...outcome } : t));
}

type RetrySource = Extract<ChatTurn, { kind: "retry" }>["source"];

function appendRetryTurn(
	rt: SessionRuntime,
	source: RetrySource,
	event: { attempt: number; maxAttempts: number; delayMs: number },
): SessionRuntime {
	return {
		...rt,
		turns: [
			...rt.turns.filter((t) => !(t.kind === "retry" && t.source === source)),
			{
				kind: "retry",
				id: crypto.randomUUID(),
				source,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
			},
		],
	};
}

function clearRetryTurns(rt: SessionRuntime, source: RetrySource): SessionRuntime {
	return rt.turns.some((t) => t.kind === "retry" && t.source === source)
		? { ...rt, turns: rt.turns.filter((t) => !(t.kind === "retry" && t.source === source)) }
		: rt;
}

export function reduceSessionEvent(rt: SessionRuntime, event: PiEvent): SessionRuntime {
	switch (event.type) {
		case "agent_start":
			return { ...rt, isStreaming: true, attemptAssistantId: null };
		case "queue_update":
			return { ...rt, queue: { steering: event.steering, followUp: event.followUp } };
		case "message_start": {
			if (event.message.role === "assistant")
				return {
					...rt,
					currentAssistantId: crypto.randomUUID(),
					attemptAssistantId: null,
					turns: clearTurnStreaming(rt.turns),
				};
			if (event.message.role === "user") {
				const message = event.message as UserMessage;
				const text = userText(message.content);
				const last = rt.turns[rt.turns.length - 1];
				if (last?.kind === "user") {
					const optimisticText = userText(last.message.content);
					if (optimisticText === text) return rt;
					const invocation = parseSkillInvocation(text);
					if (invocation && matchesSkillInvocationCommand(optimisticText, invocation)) {
						return {
							...rt,
							turns: [...rt.turns.slice(0, -1), { kind: "user", id: last.id, message }],
						};
					}
				}
				return {
					...rt,
					turns: [...rt.turns, { kind: "user", id: crypto.randomUUID(), message }],
				};
			}
			return rt;
		}
		case "message_update": {
			const ame = event.assistantMessageEvent;
			const snapshot =
				"partial" in ame
					? ame.partial
					: ame.type === "done"
						? ame.message
						: ame.type === "error"
							? ame.error
							: null;
			if (!snapshot) return rt;
			const id = rt.currentAssistantId ?? crypto.randomUUID();
			const streaming = !(ame.type === "done" || ame.type === "error");
			const turn: ChatTurn = { kind: "assistant", id, message: snapshot, streaming };
			return {
				...rt,
				currentAssistantId: streaming ? id : null,
				attemptAssistantId: streaming ? rt.attemptAssistantId : id,
				turns: rt.turns.some((t) => t.id === id)
					? rt.turns.map((t) => (t.id === id ? turn : t))
					: [...rt.turns, turn],
			};
		}
		case "message_end": {
			if (isAskUserAnswersMessage(event.message)) {
				const { toolCallId, result } = event.message.details;
				return { ...rt, askAnswers: { ...rt.askAnswers, [toolCallId]: result } };
			}
			if (event.message.role !== "assistant" || !rt.currentAssistantId) return rt;
			const id = rt.currentAssistantId;
			const turn: ChatTurn = { kind: "assistant", id, message: event.message, streaming: false };
			return {
				...rt,
				currentAssistantId: null,
				attemptAssistantId: id,
				turns: rt.turns.some((t) => t.id === id)
					? rt.turns.map((t) => (t.id === id ? turn : t))
					: [...rt.turns, turn],
			};
		}
		case "tool_execution_start":
			return {
				...rt,
				toolResults: {
					...rt.toolResults,
					[event.toolCallId]: { status: "running", raw: undefined },
				},
			};
		case "tool_execution_update":
			return {
				...rt,
				toolResults: {
					...rt.toolResults,
					[event.toolCallId]: { status: "running", raw: event.partialResult },
				},
			};
		case "tool_execution_end":
			return {
				...rt,
				toolResults: {
					...rt.toolResults,
					[event.toolCallId]: { status: event.isError ? "error" : "done", raw: event.result },
				},
			};
		case "agent_end":
			return rt;
		case "agent_settled": {
			const failure = assistantFailureText(event.terminal);
			const closer: ChatTurn = failure
				? { kind: "error", id: crypto.randomUUID(), text: failure }
				: { kind: "system", id: crypto.randomUUID(), text: "✓ Done", endedAt: Date.now() };
			return {
				...rt,
				turns: [
					...clearCompactionResuming(clearTurnStreaming(rt.turns)).filter(
						(turn) => turn.kind !== "retry",
					),
					closer,
				],
				isStreaming: false,
				currentAssistantId: null,
				attemptAssistantId: null,
			};
		}
		case "compaction_start":
			return {
				...rt,
				turns: [...rt.turns, { kind: "compaction", id: crypto.randomUUID(), status: "running" }],
			};
		case "compaction_end": {
			const settled = settleCompactionTurn(rt.turns, event);
			return event.reason === "overflow" && event.willRetry
				? {
						...rt,
						turns: removeSupersededAssistant(settled, rt.attemptAssistantId),
						attemptAssistantId: null,
					}
				: { ...rt, turns: settled };
		}
		case "auto_retry_start":
			return appendRetryTurn(
				{
					...rt,
					turns: removeSupersededAssistant(rt.turns, rt.attemptAssistantId),
					attemptAssistantId: null,
				},
				"turn",
				event,
			);
		case "auto_retry_end":
			return clearRetryTurns(rt, "turn");
		case "summarization_retry_scheduled":
			return appendRetryTurn(rt, "summarization", event);
		case "summarization_retry_finished":
			return clearRetryTurns(rt, "summarization");
		case "thinking_level_changed":
			return { ...rt, thinkingLevel: event.level };
		default:
			return rt;
	}
}

function reduceExtUi(
	rt: SessionRuntime,
	request: Exclude<ExtUiRequest, { kind: "setTitle" }>,
): SessionRuntime {
	switch (request.kind) {
		case "dismiss":
			if (rt.pendingExtUi?.id === request.id) {
				const [next, ...rest] = rt.extUiQueue;
				return { ...rt, pendingExtUi: next ?? null, extUiQueue: rest };
			}
			if (rt.extUiQueue.some((q) => q.id === request.id))
				return { ...rt, extUiQueue: rt.extUiQueue.filter((q) => q.id !== request.id) };
			return rt;
		case "select":
		case "confirm":
		case "input":
		case "editor":
			return rt.pendingExtUi
				? { ...rt, extUiQueue: [...rt.extUiQueue, request] }
				: { ...rt, pendingExtUi: request };
		case "notify":
			return {
				...rt,
				turns: [...rt.turns, { kind: "system", id: crypto.randomUUID(), text: request.message }],
			};
		case "setStatus": {
			if (request.text === null)
				return { ...rt, extUiStatus: omitKey(rt.extUiStatus, request.key) };
			return { ...rt, extUiStatus: { ...rt.extUiStatus, [request.key]: request.text } };
		}
		case "setWidget": {
			if (request.content === null)
				return { ...rt, extUiWidget: omitKey(rt.extUiWidget, request.key) };
			return { ...rt, extUiWidget: { ...rt.extUiWidget, [request.key]: request.content } };
		}
		default:
			return rt;
	}
}

interface AppState {
	status: ConnectionStatus;
	connectionGeneration: number;
	welcomeGeneration: number;
	protocolVersion: number | null;
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
	deletedSessionsByProjectArea: Record<string, Record<string, true>>;
	activeActivityByProjectArea: Record<string, ProjectAreaActivity>;
	sessions: Record<string, SessionRuntime>;
	models: WireModel[];
	providerVersion: number;
	modelsRefreshing: boolean;
	modelsFresh: boolean;
	changesRequest: {
		projectAreaId: string;
		path: string;
		navTick: number;
	} | null;
	chatLocationRequest: ChatLocationRequest | null;
	historyOpenRequest: { id: string; sessionId: string } | null;
	fsChangesByProjectArea: Record<string, { tick: number; paths: string[]; truncated: boolean }>;
	skillChangeTickByProjectArea: Record<string, number>;
	skillsSyncedTickBySession: Record<string, number>;
	activeLogin: LoginState | null;
	settingsOpen: boolean;
	settingsSection: SettingsSection;
	config: AppConfig;
	toasts: Toast[];
	setStatus: (status: ConnectionStatus) => void;
	installWelcomeSnapshot: (
		protocolVersion: number,
		projects: Project[],
		recentProjects: Project[],
		config?: AppConfig,
	) => void;
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
	noteFsChanged: (payload: ProjectFsChangedPayload) => void;
	markSkillsSynced: (sessionId: string, syncedTick: number) => void;
	updateFileTabContent: (projectAreaId: string, id: string, content: string, tick: number) => void;
	updateDiffTabContent: (
		projectAreaId: string,
		id: string,
		original: string,
		modified: string,
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
	reconcileProjectAreaSessions: (
		projectAreaId: string,
		baselineSessionIds: readonly string[],
		authoritativeSessionIds: readonly string[],
	) => void;
	reopenChat: (projectAreaId: string, sessionId: string, options?: ContentOpenOptions) => void;
	noteClosedChats: (projectAreaId: string, entries: ClosedChat[]) => void;
	hydrateSession: (
		summary: SessionSummary,
		hydrated: HydratedRuntime,
		activate?: boolean,
		syncedTick?: number,
		options?: ContentOpenOptions,
	) => void;
	appendUserMessage: (sessionId: string, text: string, attachments?: ChatAttachment[]) => void;
	appendErrorTurn: (sessionId: string, text: string) => void;
	handlePiEvent: (event: PiEvent, sessionId: string) => void;
	setModelsForProviderVersion: (providerVersion: number, models: WireModel[]) => void;
	noteProviderChanged: () => void;
	beginModelsRefresh: () => number;
	finishModelsRefresh: (providerVersion: number, result: RefreshedModels | null) => void;
	dropModelsFreshness: () => void;
	setCurrentModel: (sessionId: string, model: WireModel) => void;
	setThinkingLevel: (sessionId: string, level: ThinkingLevel) => void;
	setStats: (sessionId: string, stats: SessionStats) => void;
	setCommands: (sessionId: string, commands: SlashCommandInfo[]) => void;
	setChatDraft: (sessionId: string, text: string) => void;
	setSessionGoalLoading: (sessionId: string, projectAreaId: string) => void;
	setSessionGoalSaving: (sessionId: string, projectAreaId: string) => void;
	setSessionGoal: (sessionId: string, value: SessionGoal) => void;
	setSessionGoalError: (sessionId: string, projectAreaId: string, error: string) => void;
	clearPendingExtUi: (sessionId: string, id: string) => void;
	applyExtUi: (request: ExtUiRequest) => void;
	beginLogin: (loginId: string, providerId: string) => void;
	applyLoginFrame: (push: LoginPush) => void;
	clearLoginInput: () => void;
	clearLogin: () => void;
	openSettings: (section?: SettingsSection) => void;
	closeSettings: () => void;
	setSettingsSection: (section: SettingsSection) => void;
	applyConfig: (config: AppConfig) => void;
	requestToolView: (projectAreaId: string, tool: "files" | "changes") => void;
	requestChangesView: (projectAreaId: string, path: string) => void;
	clearChangesRequest: () => void;
	requestChatLocation: (req: ChatLocationRequest) => void;
	clearChatLocation: () => void;
	requestHistoryOpen: (target: HistoryTarget) => void;
	clearHistoryOpen: () => void;
	pushToast: (toast: Omit<Toast, "id">) => string;
	dismissToast: (id: string) => void;
}

function sortProjects(projects: Project[]): Project[] {
	return [...projects].sort((a, b) => b.lastOpened - a.lastOpened);
}

function configPatch(config: AppConfig) {
	return { config };
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

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
	const { [key]: _dropped, ...rest } = record;
	return rest;
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
		...(!alreadyDeleted
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

function withRuntime(
	s: AppState,
	sessionId: string,
	update: (rt: SessionRuntime) => SessionRuntime,
): Partial<AppState> {
	const rt = s.sessions[sessionId];
	if (!rt) return {};
	const next = update(rt);
	return next === rt ? {} : { sessions: { ...s.sessions, [sessionId]: next } };
}

function newLoginState(loginId: string, providerId: string): LoginState {
	return { loginId, providerId, status: "active" };
}

function foldLoginFrame(state: LoginState, frame: LoginFrame): LoginState {
	switch (frame.kind) {
		case "authUrl":
			return {
				...state,
				url: frame.url,
				...(frame.instructions ? { instructions: frame.instructions } : {}),
			};
		case "deviceCode":
			return {
				...state,
				deviceCode: {
					userCode: frame.userCode,
					verificationUri: frame.verificationUri,
					...(frame.expiresInSeconds ? { expiresInSeconds: frame.expiresInSeconds } : {}),
				},
			};
		case "select": {
			const { progress: _p, ...rest } = state;
			return { ...rest, input: { kind: "select", message: frame.message, options: frame.options } };
		}
		case "prompt": {
			const { progress: _p, ...rest } = state;
			return {
				...rest,
				input: {
					kind: "prompt",
					message: frame.message,
					...(frame.placeholder ? { placeholder: frame.placeholder } : {}),
					...(frame.allowEmpty ? { allowEmpty: true } : {}),
					...(frame.secret ? { secret: true } : {}),
				},
			};
		}
		case "progress":
			return { ...state, progress: frame.message };
		case "success": {
			const { input: _i, progress: _p, ...rest } = state;
			return { ...rest, status: "success" };
		}
		case "error": {
			const { input: _i, progress: _p, ...rest } = state;
			return { ...rest, status: "error", error: frame.message };
		}
	}
}

export const useAppStore = create<AppState>((set, get) => ({
	status: "connecting",
	connectionGeneration: 0,
	welcomeGeneration: 0,
	protocolVersion: null,
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
	deletedSessionsByProjectArea: Object.create(null) as Record<string, Record<string, true>>,
	activeActivityByProjectArea: {},
	sessions: {},
	models: [],
	providerVersion: 0,
	modelsRefreshing: false,
	modelsFresh: false,
	changesRequest: null,
	changesView: "list",
	diffScopeByProjectArea: {},
	chatLocationRequest: null,
	historyOpenRequest: null,
	fsChangesByProjectArea: {},
	skillChangeTickByProjectArea: {},
	skillsSyncedTickBySession: {},
	activeLogin: null,
	settingsOpen: false,
	settingsSection: SettingsSection.Providers,
	config: DEFAULT_CONFIG,
	toasts: [],
	setStatus: (status) =>
		set((state) => ({
			status,
			connectionGeneration:
				status === "connected" ? state.connectionGeneration + 1 : state.connectionGeneration,
		})),
	installWelcomeSnapshot: (protocolVersion, projects, recentProjects, config) =>
		set((state) => {
			const openProjects = sortProjects(projects.filter((project) => project.closed !== true));
			return {
				protocolVersion,
				projects: openProjects,
				recentProjects: sortProjects(recentProjects),
				...(config ? configPatch(config) : {}),
				...reconcileProjectNavigation(state, openProjects),
				...pruneExpandedProjects(state, openProjects),
				welcomeGeneration: state.welcomeGeneration + 1,
			};
		}),
	installProjectSnapshot: (projects, recentProjects) =>
		set((state) => {
			const openProjects = sortProjects(projects.filter((project) => project.closed !== true));
			return {
				projects: openProjects,
				recentProjects: sortProjects(recentProjects),
				...reconcileProjectNavigation(state, openProjects),
				...pruneExpandedProjects(state, openProjects),
			};
		}),
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
			toast.info(`ProjectArea "${name ?? "?"}" was removed`);
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
	noteFsChanged: (payload) =>
		set((s) => {
			if (s.removedProjectAreaIds[payload.projectId]) return {};
			const prev = s.fsChangesByProjectArea[payload.projectId];
			const tick = (prev?.tick ?? 0) + 1;
			const skillChanged = payload.paths.some((path) => /(^|\/)SKILL\.md$/.test(path));
			return {
				fsChangesByProjectArea: {
					...s.fsChangesByProjectArea,
					[payload.projectId]: { tick, paths: payload.paths, truncated: payload.truncated },
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
	updateDiffTabContent: (projectAreaId, id, original, modified, tick, loadedTarget) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId]) return {};
			const tabs = s.tabsByProjectArea[projectAreaId] ?? [];
			if (!tabs.some((tab) => tab.id === id && tab.kind === "diff")) return {};
			return {
				tabsByProjectArea: {
					...s.tabsByProjectArea,
					[projectAreaId]: tabs.map((tab) =>
						tab.id === id && tab.kind === "diff"
							? { ...tab, original, modified, loadedTick: tick, loadedTarget }
							: tab,
					),
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
	openChatSession: (projectAreaId, sessionId, model, thinkingLevel, syncedTick, options = {}) =>
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
					? { ...s.sessions, [sessionId]: newRuntime(model, thinkingLevel) }
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
				...(targetsLocation ? { chatLocationRequest: null } : {}),
				...(targetsHistory ? { historyOpenRequest: null } : {}),
			};
		}),
	deleteChat: (projectAreaId, sessionId, countNavigation = true) =>
		set((s) => withoutChat(s, projectAreaId, sessionId, countNavigation)),
	reconcileProjectAreaSessions: (projectAreaId, baselineSessionIds, authoritativeSessionIds) =>
		set((s) => {
			if (s.removedProjectAreaIds[projectAreaId]) return {};
			const authoritative = new Set(authoritativeSessionIds);
			let next = s;
			for (const sessionId of baselineSessionIds) {
				if (!authoritative.has(sessionId)) {
					next = withoutChat(next, projectAreaId, sessionId, false);
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
	hydrateSession: (summary, hydrated, activate = false, syncedTick, options = {}) =>
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
				...newRuntime(summary.model, summary.thinkingLevel),
				turns: hydrated.turns,
				toolResults: hydrated.toolResults,
				askAnswers: hydrated.askAnswers,
				isStreaming: summary.isStreaming,
				...(summary.queue ? { queue: summary.queue } : {}),
				...(hydrated.turnIdByMessageIndex
					? { turnIdByMessageIndex: hydrated.turnIdByMessageIndex }
					: {}),
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
	appendUserMessage: (sessionId, text, attachments) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				turns: [
					...rt.turns,
					{
						kind: "user",
						id: crypto.randomUUID(),
						message: {
							role: "user",
							content:
								attachments && attachments.length > 0
									? [
											...(text ? [{ type: "text" as const, text }] : []),
											...attachments.map((a) => a.content),
										]
									: text,
							timestamp: Date.now(),
						},
						...(attachments && attachments.length > 0
							? { attachmentNames: attachments.map((a) => a.name) }
							: {}),
					},
				],
			})),
		),
	appendErrorTurn: (sessionId, text) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				isStreaming: false,
				currentAssistantId: null,
				attemptAssistantId: null,
				turns: [...clearTurnStreaming(rt.turns), { kind: "error", id: crypto.randomUUID(), text }],
			})),
		),
	handlePiEvent: (event, sessionId) =>
		set((s) => withRuntime(s, sessionId, (rt) => reduceSessionEvent(rt, event))),
	setModelsForProviderVersion: (providerVersion, models) =>
		set((s) => (s.providerVersion === providerVersion ? { models, modelsFresh: false } : s)),
	noteProviderChanged: () =>
		set((s) => ({
			models: [],
			modelsFresh: false,
			modelsRefreshing: false,
			providerVersion: s.providerVersion + 1,
		})),
	beginModelsRefresh: () => {
		const providerVersion = get().providerVersion;
		set({ modelsRefreshing: true });
		return providerVersion;
	},
	dropModelsFreshness: () => set({ modelsFresh: false }),
	finishModelsRefresh: (providerVersion, result) =>
		set((s) =>
			s.providerVersion === providerVersion
				? {
						modelsRefreshing: false,
						models: result?.models ?? s.models,
						modelsFresh: result ? result.complete : s.modelsFresh,
					}
				: s,
		),
	setCurrentModel: (sessionId, model) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, model }))),
	setThinkingLevel: (sessionId, level) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, thinkingLevel: level }))),
	setStats: (sessionId, stats) => set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, stats }))),
	setCommands: (sessionId, commands) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, commands }))),
	setChatDraft: (sessionId, draft) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, draft }))),
	setSessionGoalLoading: (sessionId, projectAreaId) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, projectAreaId, status: "loading", error: null },
			})),
		),
	setSessionGoalSaving: (sessionId, projectAreaId) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, projectAreaId, status: "saving", error: null },
			})),
		),
	setSessionGoal: (sessionId, value) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: {
					projectAreaId: value.projectId,
					status: "ready",
					goal: value.goal,
					tasks: value.tasks,
					updatedAt: value.updatedAt,
					error: null,
				},
			})),
		),
	setSessionGoalError: (sessionId, projectAreaId, error) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, projectAreaId, status: "error", error },
			})),
		),
	clearPendingExtUi: (sessionId, id) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => {
				if (rt.pendingExtUi?.id !== id) return rt;
				const [next, ...rest] = rt.extUiQueue;
				return { ...rt, pendingExtUi: next ?? null, extUiQueue: rest };
			}),
		),
	applyExtUi: (request) =>
		set((s): Partial<AppState> => {
			if (request.kind === "setTitle") {
				for (const [wsId, tabs] of Object.entries(s.tabsByProjectArea)) {
					const chat = tabs.find(
						(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === request.sessionId,
					);
					if (!chat) continue;
					if (chat.name === request.title) continue;
					return {
						tabsByProjectArea: {
							...s.tabsByProjectArea,
							[wsId]: tabs.map((tab) =>
								tab.id === chat.id ? { ...chat, name: request.title } : tab,
							),
						},
					};
				}
				for (const [wsId, chats] of Object.entries(s.closedChatsByProjectArea)) {
					if (!chats.some((chat) => chat.sessionId === request.sessionId)) continue;
					return {
						closedChatsByProjectArea: {
							...s.closedChatsByProjectArea,
							[wsId]: chats.map((chat) =>
								chat.sessionId === request.sessionId ? { ...chat, title: request.title } : chat,
							),
						},
					};
				}
				return {};
			}
			return withRuntime(s, request.sessionId, (rt) => reduceExtUi(rt, request));
		}),
	beginLogin: (loginId, providerId) =>
		set((s) =>
			s.activeLogin?.loginId === loginId ? {} : { activeLogin: newLoginState(loginId, providerId) },
		),
	applyLoginFrame: (push) =>
		set((s) => {
			const cur = s.activeLogin;
			if (cur && cur.loginId !== push.loginId && cur.status === "active") return {};
			const base =
				cur && cur.loginId === push.loginId ? cur : newLoginState(push.loginId, push.providerId);
			return { activeLogin: foldLoginFrame(base, push.frame) };
		}),
	clearLoginInput: () =>
		set((s) => {
			if (!s.activeLogin?.input) return {};
			const { input: _drop, ...rest } = s.activeLogin;
			return { activeLogin: rest };
		}),
	clearLogin: () => set({ activeLogin: null }),
	openSettings: (section = SettingsSection.Providers) =>
		set({ settingsOpen: true, settingsSection: section }),
	closeSettings: () => set({ settingsOpen: false }),
	setSettingsSection: (section) => set({ settingsSection: section }),
	applyConfig: (config) => set(configPatch(config)),
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
	pushToast: (toast) => {
		const twin = get().toasts.find(
			(t) => t.variant === toast.variant && t.title === toast.title && t.message === toast.message,
		);
		if (twin) return twin.id;
		const id = crypto.randomUUID();
		set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
		return id;
	},
	dismissToast: (id) =>
		set((s) =>
			s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : {},
		),
}));

export const toast = {
	error: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "error", message, ...(title ? { title } : {}) }),
	success: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "success", message, ...(title ? { title } : {}) }),
	info: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "info", message, ...(title ? { title } : {}) }),
};
