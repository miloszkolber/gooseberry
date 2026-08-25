import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiRequest,
	GitDiffScope,
	LoginFrame,
	LoginPush,
	PiEvent,
	PiProfileDescriptor,
	Project,
	RefreshedModels,
	SessionGoal,
	SessionQueueState,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThemeId,
	ThinkingLevel,
	UserMessage,
	WireModel,
	Workspace,
	WorkspaceFsChangedPayload,
} from "@mewa-code/contracts";
import { DEFAULT_CONFIG, isAskUserAnswersMessage } from "@mewa-code/contracts";
import { create } from "zustand";
import type { LoginState } from "../auth";
import { assistantFailureText } from "../chat/assistantFailure";
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
	selectActiveWorkspaceProjectId,
	selectWorkspaceNavTick,
	selectWorkspaceSessionIds,
	selectWorkspaceTick,
} from "./selectors";

export interface FileTab {
	kind: "file";
	id: string;
	workspaceId: string;
	name: string;
	path: string;
	content: string;
	savedContent?: string;
	dirty?: boolean;
	view?: "rendered" | "source";
	loadedTick?: number;
}
export interface ChatTab {
	kind: "chat";
	id: string;
	workspaceId: string;
	name: string;
	sessionId: string;
}
export type DiffTabView = "split" | "inline";
export interface DiffTab {
	kind: "diff";
	id: string;
	workspaceId: string;
	name: string;
	path: string;
	scope: GitDiffScope;
	loadedTarget: string;
	original: string;
	modified: string;
	view?: DiffTabView;
	rendered?: boolean;
	ignoreWhitespace?: boolean;
	loadedTick?: number;
}
export type EditorTab = FileTab | ChatTab | DiffTab;
export type WorkspaceActivity = "files" | "changes";

export function chatTabId(workspaceId: string, sessionId: string): string {
	return tupleKey("chat", workspaceId, sessionId);
}

function editorResourceIdentity(tab: EditorTab): string {
	if (tab.kind === "file") return tupleKey("editor-resource", "file", tab.path);
	if (tab.kind === "diff") {
		const reference =
			tab.scope.kind === "commit"
				? tab.scope.sha
				: tab.scope.kind === "pinned"
					? tab.scope.baseRef
					: "";
		return tupleKey("editor-resource", "diff", tab.path, tab.scope.kind, reference);
	}
	return tupleKey("editor-resource", "chat", tab.sessionId);
}

function editorSessionId(tab: EditorTab): string | null {
	return tab.kind === "chat" ? tab.sessionId : null;
}

function availableEditorTabId(tabs: readonly EditorTab[], tab: EditorTab): string {
	const identity = editorResourceIdentity(tab);
	const existing = tabs.find((candidate) => editorResourceIdentity(candidate) === identity);
	if (existing) return existing.id;
	if (!tabs.some((candidate) => candidate.id === tab.id)) return tab.id;
	let fallback = randomId("editor-cache");
	while (tabs.some((candidate) => candidate.id === fallback)) fallback = randomId("editor-cache");
	return fallback;
}

export type TabIntent = "preview" | "keep";

export interface RouteChatTarget {
	workspaceId: string;
	sessionId: string;
	navTick: number;
	validated: boolean;
}

export interface EditorOpenOptions {
	activate?: boolean;
	claimPreview?: boolean;
}

export const SettingsSection = {
	Providers: "providers",
	Extensions: "extensions",
	Appearance: "appearance",
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
	workspaceId: string;
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
	workspaceId: string | null;
	status: "idle" | "loading" | "saving" | "ready" | "error";
	goal: string | null;
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
		goal: { workspaceId: null, status: "idle", goal: null, updatedAt: null, error: null },
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
	workspaces: Record<string, Workspace[]>;
	removedWorkspaceIds: Record<string, true>;
	expandedProjectIds: Record<string, true>;
	selectedProjectId: string | null;
	activeWorkspaceId: string | null;
	routeChatTarget: RouteChatTarget | null;
	routeChatTargetGeneration: number;
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
	previewTabByWorkspace: Record<string, string>;
	navTickByWorkspace: Record<string, number>;
	closedChatsByWorkspace: Record<string, ClosedChat[]>;
	deletedSessionsByWorkspace: Record<string, Record<string, true>>;
	activeActivityByWorkspace: Record<string, WorkspaceActivity>;
	sessions: Record<string, SessionRuntime>;
	models: WireModel[];
	providerVersion: number;
	modelsRefreshing: boolean;
	modelsFresh: boolean;
	changesRequest: {
		workspaceId: string;
		path: string;
		navTick: number;
	} | null;
	chatLocationRequest: ChatLocationRequest | null;
	historyOpenRequest: { id: string; sessionId: string } | null;
	fsChangesByWorkspace: Record<string, { tick: number; paths: string[]; truncated: boolean }>;
	skillChangeTickByWorkspace: Record<string, number>;
	skillsSyncedTickBySession: Record<string, number>;
	activeLogin: LoginState | null;
	settingsOpen: boolean;
	settingsSection: SettingsSection;
	piProfile: PiProfileDescriptor | null;
	theme: ThemeId;
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
	setWorkspaces: (projectId: string, workspaces: Workspace[]) => void;
	addWorkspace: (workspace: Workspace) => void;
	updateWorkspace: (workspace: Workspace) => void;
	removeWorkspace: (projectId: string, workspaceId: string) => void;
	applyWorkspaceRemoved: (projectId: string, workspaceId: string) => void;
	selectProject: (projectId: string, opts?: { reveal?: boolean }) => void;
	toggleProjectExpanded: (projectId: string) => void;
	expandProject: (projectId: string) => void;
	hydrateExpandedProjects: (projectIds: readonly string[]) => void;
	selectMain: () => void;
	activateWorkspace: (workspace: Pick<Workspace, "id" | "projectId">) => void;
	activateWorkspaceFromRoute: (
		workspace: Pick<Workspace, "id" | "projectId">,
		sessionId?: string,
	) => void;
	validateRouteChatTarget: (sessionId: string) => void;
	clearRouteChatTarget: () => void;
	openTab: (tab: EditorTab, intent: TabIntent, options?: EditorOpenOptions) => void;
	closeTab: (id: string, countNavigation?: boolean, workspaceId?: string) => void;
	setActiveTab: (id: string, intent?: TabIntent) => void;
	noteNavigation: (workspaceId: string) => void;
	setFileTabView: (id: string, view: "rendered" | "source") => void;
	setDiffTabView: (id: string, view: DiffTabView) => void;
	setDiffTabRendered: (id: string, rendered: boolean) => void;
	setDiffTabIgnoreWhitespace: (id: string, ignoreWhitespace: boolean) => void;
	changesView: "list" | "tree";
	setChangesView: (view: "list" | "tree") => void;
	diffScopeByWorkspace: Record<string, GitDiffScope>;
	setDiffScope: (workspaceId: string, scope: GitDiffScope) => void;
	noteFsChanged: (payload: WorkspaceFsChangedPayload) => void;
	markSkillsSynced: (sessionId: string, syncedTick: number) => void;
	updateFileTabContent: (workspaceId: string, id: string, content: string, tick: number) => void;
	setFileTabContent: (workspaceId: string, id: string, content: string) => void;
	markFileTabSaved: (workspaceId: string, id: string, content: string) => void;
	updateDiffTabContent: (
		workspaceId: string,
		id: string,
		original: string,
		modified: string,
		tick: number,
		loadedTarget: string,
	) => void;
	clearWorkspaceTabs: (workspaceId: string) => void;
	setActiveActivity: (workspaceId: string, activity: WorkspaceActivity) => void;
	openChatSession: (
		workspaceId: string,
		sessionId: string,
		model: WireModel | null,
		thinkingLevel: ThinkingLevel,
		syncedTick?: number,
		options?: EditorOpenOptions,
	) => void;
	closeChatRuntime: (sessionId: string) => void;
	closeChatToHistory: (sessionId: string, workspaceId?: string, countNavigation?: boolean) => void;
	deleteChat: (workspaceId: string, sessionId: string, countNavigation?: boolean) => void;
	reconcileWorkspaceSessions: (
		workspaceId: string,
		baselineSessionIds: readonly string[],
		authoritativeSessionIds: readonly string[],
	) => void;
	reopenChat: (workspaceId: string, sessionId: string, options?: EditorOpenOptions) => void;
	noteClosedChats: (workspaceId: string, entries: ClosedChat[]) => void;
	hydrateSession: (
		summary: SessionSummary,
		hydrated: HydratedRuntime,
		activate?: boolean,
		syncedTick?: number,
		options?: EditorOpenOptions,
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
	setSessionGoalLoading: (sessionId: string, workspaceId: string) => void;
	setSessionGoalSaving: (sessionId: string, workspaceId: string) => void;
	setSessionGoal: (sessionId: string, value: SessionGoal) => void;
	setSessionGoalError: (sessionId: string, workspaceId: string, error: string) => void;
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
	applyPiProfile: (profile: PiProfileDescriptor) => void;
	requestToolView: (workspaceId: string, tool: "files" | "changes") => void;
	requestChangesView: (workspaceId: string, path: string) => void;
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
	return {
		theme: config.theme,
	};
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
	state: Pick<AppState, "selectedProjectId" | "activeWorkspaceId" | "workspaces">,
	projects: Project[],
): Pick<AppState, "selectedProjectId" | "activeWorkspaceId"> | Record<string, never> {
	const currentProjectId = selectActiveWorkspaceProjectId(state) ?? state.selectedProjectId;
	if (!currentProjectId || projects.some((project) => project.id === currentProjectId)) return {};
	return { selectedProjectId: projects[0]?.id ?? null, activeWorkspaceId: null };
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
	const { [key]: _dropped, ...rest } = record;
	return rest;
}

function isSessionDeleted(
	state: Pick<AppState, "deletedSessionsByWorkspace">,
	workspaceId: string,
	sessionId: string,
): boolean {
	return state.deletedSessionsByWorkspace[workspaceId]?.[sessionId] === true;
}

function patchDiffTab(
	state: Pick<AppState, "activeWorkspaceId" | "tabsByWorkspace">,
	id: string,
	patch: Partial<Omit<DiffTab, "kind" | "id">>,
): Partial<AppState> {
	const wsId = state.activeWorkspaceId;
	if (!wsId) return {};
	const tabs = state.tabsByWorkspace[wsId] ?? [];
	if (!tabs.some((t) => t.id === id && t.kind === "diff")) return {};
	return {
		tabsByWorkspace: {
			...state.tabsByWorkspace,
			[wsId]: tabs.map((t) => (t.id === id && t.kind === "diff" ? { ...t, ...patch } : t)),
		},
	};
}

function bumpNav(s: AppState, workspaceId: string): Record<string, number> {
	return { ...s.navTickByWorkspace, [workspaceId]: selectWorkspaceNavTick(s, workspaceId) + 1 };
}

function withoutChat(
	s: AppState,
	workspaceId: string,
	sessionId: string,
	countNavigation: boolean,
): AppState {
	if (s.removedWorkspaceIds[workspaceId]) return s;
	const alreadyDeleted = isSessionDeleted(s, workspaceId, sessionId);
	const tabs = s.tabsByWorkspace[workspaceId] ?? [];
	const sessionTabs = tabs.filter((candidate) => editorSessionId(candidate) === sessionId);
	const closed = s.closedChatsByWorkspace[workspaceId] ?? [];
	const inHistory = closed.some((chat) => chat.sessionId === sessionId);
	const hasRuntime = s.sessions[sessionId] !== undefined;
	const hasSkillBaseline = Object.hasOwn(s.skillsSyncedTickBySession, sessionId);
	const targetsLocation =
		s.chatLocationRequest?.workspaceId === workspaceId &&
		s.chatLocationRequest.sessionId === sessionId;
	const targetsRoute =
		s.routeChatTarget?.workspaceId === workspaceId && s.routeChatTarget.sessionId === sessionId;
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
		s.activeTabByWorkspace[workspaceId] !== null &&
		removedTabIds.has(s.activeTabByWorkspace[workspaceId] ?? "");
	return {
		...s,
		...(!alreadyDeleted
			? {
					deletedSessionsByWorkspace: Object.assign(
						Object.create(null),
						s.deletedSessionsByWorkspace,
						{
							[workspaceId]: Object.assign(
								Object.create(null),
								s.deletedSessionsByWorkspace[workspaceId],
								{ [sessionId]: true as const },
							) as Record<string, true>,
						},
					) as Record<string, Record<string, true>>,
				}
			: {}),
		...(sessionTabs.length > 0
			? { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceId]: remaining } }
			: {}),
		...(wasActive
			? {
					activeTabByWorkspace: {
						...s.activeTabByWorkspace,
						[workspaceId]: remaining.at(-1)?.id ?? null,
					},
					navTickByWorkspace: countNavigation ? bumpNav(s, workspaceId) : s.navTickByWorkspace,
				}
			: {}),
		...(inHistory
			? {
					closedChatsByWorkspace: {
						...s.closedChatsByWorkspace,
						[workspaceId]: closed.filter((chat) => chat.sessionId !== sessionId),
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
	workspaces: {},
	removedWorkspaceIds: Object.create(null) as Record<string, true>,
	expandedProjectIds: Object.create(null) as Record<string, true>,
	selectedProjectId: null,
	activeWorkspaceId: null,
	routeChatTarget: null,
	routeChatTargetGeneration: 0,
	tabsByWorkspace: {},
	activeTabByWorkspace: {},
	previewTabByWorkspace: {},
	navTickByWorkspace: {},
	closedChatsByWorkspace: {},
	deletedSessionsByWorkspace: Object.create(null) as Record<string, Record<string, true>>,
	activeActivityByWorkspace: {},
	sessions: {},
	models: [],
	providerVersion: 0,
	modelsRefreshing: false,
	modelsFresh: false,
	changesRequest: null,
	changesView: "list",
	diffScopeByWorkspace: {},
	chatLocationRequest: null,
	historyOpenRequest: null,
	fsChangesByWorkspace: {},
	skillChangeTickByWorkspace: {},
	skillsSyncedTickBySession: {},
	activeLogin: null,
	settingsOpen: false,
	settingsSection: SettingsSection.Providers,
	piProfile: null,
	theme: DEFAULT_CONFIG.theme,
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
	setWorkspaces: (projectId, workspaces) =>
		set((s) => ({
			workspaces: {
				...s.workspaces,
				[projectId]: workspaces.filter((workspace) => !s.removedWorkspaceIds[workspace.id]),
			},
		})),
	addWorkspace: (workspace) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspace.id]) return {};
			const list = s.workspaces[workspace.projectId];
			if (!list) return {};
			return {
				workspaces: {
					...s.workspaces,
					[workspace.projectId]: list.some((w) => w.id === workspace.id)
						? list.map((w) => (w.id === workspace.id ? { ...w, ...workspace } : w))
						: [...list, workspace],
				},
			};
		}),
	updateWorkspace: (workspace) =>
		set((s) => {
			const list = s.workspaces[workspace.projectId];
			if (!list?.some((w) => w.id === workspace.id)) return {};
			return {
				workspaces: {
					...s.workspaces,
					[workspace.projectId]: list.map((w) =>
						w.id === workspace.id
							? { ...workspace, ...(w.diffStats ? { diffStats: w.diffStats } : {}) }
							: w,
					),
				},
			};
		}),
	removeWorkspace: (projectId, workspaceId) =>
		set((s) => {
			const list = s.workspaces[projectId];
			if (!list) return {};
			return {
				workspaces: { ...s.workspaces, [projectId]: list.filter((w) => w.id !== workspaceId) },
			};
		}),
	applyWorkspaceRemoved: (projectId, workspaceId) => {
		const s = get();
		const wasActive = s.activeWorkspaceId === workspaceId;
		const name = s.workspaces[projectId]?.find((w) => w.id === workspaceId)?.name;
		set((state) => {
			const removedSessions = new Set(selectWorkspaceSessionIds(state, workspaceId));
			return {
				removedWorkspaceIds: Object.assign(Object.create(null), state.removedWorkspaceIds, {
					[workspaceId]: true,
				}) as Record<string, true>,
				fsChangesByWorkspace: omitKey(state.fsChangesByWorkspace, workspaceId),
				skillChangeTickByWorkspace: omitKey(state.skillChangeTickByWorkspace, workspaceId),
				diffScopeByWorkspace: omitKey(state.diffScopeByWorkspace, workspaceId),
				changesRequest:
					state.changesRequest?.workspaceId === workspaceId ? null : state.changesRequest,
				chatLocationRequest:
					state.chatLocationRequest?.workspaceId === workspaceId ? null : state.chatLocationRequest,
				routeChatTarget:
					state.routeChatTarget?.workspaceId === workspaceId ? null : state.routeChatTarget,
				historyOpenRequest:
					state.historyOpenRequest && removedSessions.has(state.historyOpenRequest.sessionId)
						? null
						: state.historyOpenRequest,
			};
		});
		s.removeWorkspace(projectId, workspaceId);
		s.clearWorkspaceTabs(workspaceId);
		if (wasActive) {
			s.selectProject(projectId);
			toast.info(`Workspace "${name ?? "?"}" was removed`);
		}
	},
	selectProject: (selectedProjectId, opts) =>
		set((state) => ({
			selectedProjectId,
			activeWorkspaceId: null,
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
		set({ selectedProjectId: null, activeWorkspaceId: null, routeChatTarget: null }),
	activateWorkspace: (workspace) =>
		set((state) =>
			state.removedWorkspaceIds[workspace.id]
				? {}
				: { selectedProjectId: workspace.projectId, activeWorkspaceId: workspace.id },
		),
	activateWorkspaceFromRoute: (workspace, sessionId) =>
		set((state) => {
			if (state.removedWorkspaceIds[workspace.id]) return {};
			return {
				selectedProjectId: workspace.projectId,
				activeWorkspaceId: workspace.id,
				navTickByWorkspace: sessionId
					? {
							...state.navTickByWorkspace,
							[workspace.id]: selectWorkspaceNavTick(state, workspace.id) + 1,
						}
					: state.navTickByWorkspace,
				routeChatTarget: sessionId
					? {
							workspaceId: workspace.id,
							sessionId,
							navTick: selectWorkspaceNavTick(state, workspace.id) + 1,
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
			const wsId = tab.workspaceId;
			const sessionId = editorSessionId(tab);
			if (
				s.removedWorkspaceIds[wsId] ||
				(sessionId !== null && isSessionDeleted(s, wsId, sessionId))
			) {
				return {};
			}
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const resolvedId = availableEditorTabId(tabs, tab);
			const resolvedTab = resolvedId === tab.id ? tab : { ...tab, id: resolvedId };
			const previewCompatible = resolvedTab.kind === "file" || resolvedTab.kind === "diff";
			const effectiveIntent = previewCompatible ? intent : "keep";
			const claimPreview = previewCompatible && options.claimPreview === true;
			const preview = s.previewTabByWorkspace[wsId];
			const activeTabByWorkspace =
				options.activate === false
					? s.activeTabByWorkspace
					: { ...s.activeTabByWorkspace, [wsId]: resolvedTab.id };
			const existingIndex = tabs.findIndex((candidate) => candidate.id === resolvedTab.id);
			if (existingIndex >= 0) {
				const existing = tabs[existingIndex];
				return {
					tabsByWorkspace:
						existing === resolvedTab
							? s.tabsByWorkspace
							: { ...s.tabsByWorkspace, [wsId]: tabs.with(existingIndex, resolvedTab) },
					activeTabByWorkspace,
					previewTabByWorkspace:
						effectiveIntent === "keep" &&
						(preview === resolvedTab.id || (claimPreview && preview !== undefined))
							? omitKey(s.previewTabByWorkspace, wsId)
							: s.previewTabByWorkspace,
				};
			}
			const at =
				(effectiveIntent === "preview" || claimPreview) && preview
					? tabs.findIndex((t) => t.id === preview)
					: -1;
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[wsId]: at === -1 ? [...tabs, resolvedTab] : tabs.with(at, resolvedTab),
				},
				activeTabByWorkspace,
				previewTabByWorkspace:
					effectiveIntent === "preview"
						? { ...s.previewTabByWorkspace, [wsId]: resolvedTab.id }
						: claimPreview && preview
							? omitKey(s.previewTabByWorkspace, wsId)
							: s.previewTabByWorkspace,
			};
		}),
	closeTab: (id, countNavigation = true, workspaceId) =>
		set((s) => {
			const wsId = workspaceId ?? s.activeWorkspaceId;
			if (!wsId || s.removedWorkspaceIds[wsId]) return {};
			const tabs = (s.tabsByWorkspace[wsId] ?? []).filter((t) => t.id !== id);
			const wasActive = s.activeTabByWorkspace[wsId] === id;
			return {
				tabsByWorkspace: { ...s.tabsByWorkspace, [wsId]: tabs },
				activeTabByWorkspace: {
					...s.activeTabByWorkspace,
					[wsId]: wasActive ? (tabs.at(-1)?.id ?? null) : (s.activeTabByWorkspace[wsId] ?? null),
				},
				navTickByWorkspace: wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByWorkspace,
				...(s.previewTabByWorkspace[wsId] === id
					? { previewTabByWorkspace: omitKey(s.previewTabByWorkspace, wsId) }
					: {}),
			};
		}),
	setActiveTab: (id, intent) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			return {
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [wsId]: id },
				navTickByWorkspace: bumpNav(s, wsId),
				...(intent === "keep" && s.previewTabByWorkspace[wsId] === id
					? { previewTabByWorkspace: omitKey(s.previewTabByWorkspace, wsId) }
					: {}),
			};
		}),
	noteNavigation: (workspaceId) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId] ? {} : { navTickByWorkspace: bumpNav(s, workspaceId) },
		),
	setFileTabView: (id, view) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			if (!tabs.some((t) => t.id === id && t.kind === "file")) return {};
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[wsId]: tabs.map((t) => (t.id === id && t.kind === "file" ? { ...t, view } : t)),
				},
			};
		}),
	setDiffTabView: (id, view) => set((s) => patchDiffTab(s, id, { view })),
	setDiffTabRendered: (id, rendered) => set((s) => patchDiffTab(s, id, { rendered })),
	setDiffTabIgnoreWhitespace: (id, ignoreWhitespace) =>
		set((s) => patchDiffTab(s, id, { ignoreWhitespace })),
	setChangesView: (view) => set({ changesView: view }),
	setDiffScope: (workspaceId, scope) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId]
				? {}
				: { diffScopeByWorkspace: { ...s.diffScopeByWorkspace, [workspaceId]: scope } },
		),
	noteFsChanged: (payload) =>
		set((s) => {
			if (s.removedWorkspaceIds[payload.workspaceId]) return {};
			const prev = s.fsChangesByWorkspace[payload.workspaceId];
			const tick = (prev?.tick ?? 0) + 1;
			const skillChanged = payload.skillChange !== "none";
			return {
				fsChangesByWorkspace: {
					...s.fsChangesByWorkspace,
					[payload.workspaceId]: { tick, paths: payload.paths, truncated: payload.truncated },
				},
				...(skillChanged
					? {
							skillChangeTickByWorkspace: {
								...s.skillChangeTickByWorkspace,
								[payload.workspaceId]: tick,
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
	updateFileTabContent: (workspaceId, id, content, tick) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			if (!tabs.some((tab) => tab.id === id && tab.kind === "file")) return {};
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[workspaceId]: tabs.map((tab) =>
						tab.id === id && tab.kind === "file"
							? tab.dirty
								? { ...tab, loadedTick: tick }
								: { ...tab, content, savedContent: content, dirty: false, loadedTick: tick }
							: tab,
					),
				},
			};
		}),
	setFileTabContent: (workspaceId, id, content) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[workspaceId]: tabs.map((tab) => {
						if (tab.id !== id || tab.kind !== "file" || tab.content === content) return tab;
						const savedContent = tab.savedContent ?? tab.content;
						return { ...tab, content, dirty: content !== savedContent };
					}),
				},
			};
		}),
	markFileTabSaved: (workspaceId, id, content) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[workspaceId]: tabs.map((tab) =>
						tab.id === id && tab.kind === "file" && tab.content === content
							? { ...tab, savedContent: content, dirty: false }
							: tab,
					),
				},
			};
		}),
	updateDiffTabContent: (workspaceId, id, original, modified, tick, loadedTarget) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			if (!tabs.some((tab) => tab.id === id && tab.kind === "diff")) return {};
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[workspaceId]: tabs.map((tab) =>
						tab.id === id && tab.kind === "diff"
							? { ...tab, original, modified, loadedTick: tick, loadedTarget }
							: tab,
					),
				},
			};
		}),
	clearWorkspaceTabs: (workspaceId) =>
		set((s) => {
			const sessions = { ...s.sessions };
			const skillsSyncedTickBySession = { ...s.skillsSyncedTickBySession };
			for (const sessionId of selectWorkspaceSessionIds(s, workspaceId)) {
				delete sessions[sessionId];
				delete skillsSyncedTickBySession[sessionId];
			}
			return {
				tabsByWorkspace: omitKey(s.tabsByWorkspace, workspaceId),
				activeTabByWorkspace: omitKey(s.activeTabByWorkspace, workspaceId),
				previewTabByWorkspace: omitKey(s.previewTabByWorkspace, workspaceId),
				navTickByWorkspace: omitKey(s.navTickByWorkspace, workspaceId),
				closedChatsByWorkspace: omitKey(s.closedChatsByWorkspace, workspaceId),
				activeActivityByWorkspace: omitKey(s.activeActivityByWorkspace, workspaceId),
				sessions,
				skillsSyncedTickBySession,
			};
		}),
	setActiveActivity: (workspaceId, activity) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId]
				? {}
				: {
						activeActivityByWorkspace: {
							...s.activeActivityByWorkspace,
							[workspaceId]: activity,
						},
					},
		),
	openChatSession: (workspaceId, sessionId, model, thinkingLevel, syncedTick, options = {}) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId] || isSessionDeleted(s, workspaceId, sessionId)) {
				return {};
			}
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === sessionId,
			);
			const preferred: ChatTab = existing ?? {
				kind: "chat",
				id: chatTabId(workspaceId, sessionId),
				workspaceId,
				name: "Chat",
				sessionId,
			};
			const id = existing?.id ?? availableEditorTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			const fresh = !s.sessions[sessionId];
			return {
				tabsByWorkspace: existing
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [workspaceId]: [...tabs, tab] },
				activeTabByWorkspace:
					options.activate === false
						? s.activeTabByWorkspace
						: { ...s.activeTabByWorkspace, [workspaceId]: id },
				navTickByWorkspace:
					options.activate === false ? s.navTickByWorkspace : bumpNav(s, workspaceId),
				sessions: fresh
					? { ...s.sessions, [sessionId]: newRuntime(model, thinkingLevel) }
					: s.sessions,
				...(fresh
					? {
							skillsSyncedTickBySession: {
								...s.skillsSyncedTickBySession,
								[sessionId]: syncedTick ?? selectWorkspaceTick(s, workspaceId),
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
	closeChatToHistory: (sessionId, workspaceId, countNavigation = true) =>
		set((s) => {
			const wsId = workspaceId ?? s.activeWorkspaceId;
			if (!wsId || s.removedWorkspaceIds[wsId]) return {};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const tab = tabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
			if (!tab) return {};
			const remaining = tabs.filter((t) => t.id !== tab.id);
			const wasActive = s.activeTabByWorkspace[wsId] === tab.id;
			const entry: ClosedChat = { sessionId, title: tab.name, closedAt: Date.now() };
			const targetsLocation =
				s.chatLocationRequest?.workspaceId === wsId &&
				s.chatLocationRequest.sessionId === sessionId;
			const targetsHistory = s.historyOpenRequest?.sessionId === sessionId;
			return {
				tabsByWorkspace: { ...s.tabsByWorkspace, [wsId]: remaining },
				navTickByWorkspace: wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByWorkspace,
				activeTabByWorkspace: {
					...s.activeTabByWorkspace,
					[wsId]: wasActive
						? (remaining.at(-1)?.id ?? null)
						: (s.activeTabByWorkspace[wsId] ?? null),
				},
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[wsId]: [entry, ...(s.closedChatsByWorkspace[wsId] ?? [])],
				},
				...(targetsLocation ? { chatLocationRequest: null } : {}),
				...(targetsHistory ? { historyOpenRequest: null } : {}),
			};
		}),
	deleteChat: (workspaceId, sessionId, countNavigation = true) =>
		set((s) => withoutChat(s, workspaceId, sessionId, countNavigation)),
	reconcileWorkspaceSessions: (workspaceId, baselineSessionIds, authoritativeSessionIds) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const authoritative = new Set(authoritativeSessionIds);
			let next = s;
			for (const sessionId of baselineSessionIds) {
				if (!authoritative.has(sessionId)) {
					next = withoutChat(next, workspaceId, sessionId, false);
				}
			}
			return next;
		}),
	reopenChat: (wsId, sessionId, options = {}) =>
		set((s) => {
			if (s.removedWorkspaceIds[wsId] || isSessionDeleted(s, wsId, sessionId)) return {};
			const closed = s.closedChatsByWorkspace[wsId] ?? [];
			const entry = closed.find((c) => c.sessionId === sessionId);
			if (!entry) return {};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === sessionId,
			);
			const preferred: ChatTab = {
				kind: "chat",
				id: existing?.id ?? chatTabId(wsId, sessionId),
				workspaceId: wsId,
				name: entry.title,
				sessionId,
			};
			const id = existing?.id ?? availableEditorTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			return {
				tabsByWorkspace: existing
					? existing.name === tab.name
						? s.tabsByWorkspace
						: {
								...s.tabsByWorkspace,
								[wsId]: tabs.map((candidate) => (candidate === existing ? tab : candidate)),
							}
					: { ...s.tabsByWorkspace, [wsId]: [...tabs, tab] },
				activeTabByWorkspace:
					options.activate === false
						? s.activeTabByWorkspace
						: { ...s.activeTabByWorkspace, [wsId]: id },
				navTickByWorkspace: options.activate === false ? s.navTickByWorkspace : bumpNav(s, wsId),
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[wsId]: closed.filter((c) => c.sessionId !== sessionId),
				},
			};
		}),
	noteClosedChats: (workspaceId, entries) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const existing = s.closedChatsByWorkspace[workspaceId] ?? [];
			const known = new Set([
				...existing.map((c) => c.sessionId),
				...(s.tabsByWorkspace[workspaceId] ?? [])
					.filter((t): t is ChatTab => t.kind === "chat")
					.map((t) => t.sessionId),
			]);
			const fresh = entries.filter(
				(e) =>
					!isSessionDeleted(s, workspaceId, e.sessionId) &&
					!known.has(e.sessionId) &&
					!s.sessions[e.sessionId],
			);
			if (fresh.length === 0) return {};
			return {
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[workspaceId]: [...existing, ...fresh].sort((a, b) => b.closedAt - a.closedAt),
				},
			};
		}),
	hydrateSession: (summary, hydrated, activate = false, syncedTick, options = {}) =>
		set((s) => {
			if (
				s.removedWorkspaceIds[summary.workspaceId] ||
				isSessionDeleted(s, summary.workspaceId, summary.sessionId)
			) {
				return {};
			}
			if (s.sessions[summary.sessionId]) return {};
			const wsId = summary.workspaceId;
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
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === summary.sessionId,
			);
			const preferred: ChatTab = {
				kind: "chat",
				id: existing?.id ?? chatTabId(wsId, summary.sessionId),
				workspaceId: wsId,
				name: summary.title,
				sessionId: summary.sessionId,
			};
			const id = existing?.id ?? availableEditorTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			const hasActive = s.activeTabByWorkspace[wsId] != null;
			const takesFocus = options.activate !== false && (activate || !hasActive);
			const closed = s.closedChatsByWorkspace[wsId] ?? [];
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
				tabsByWorkspace: existing
					? existing.name === tab.name
						? s.tabsByWorkspace
						: {
								...s.tabsByWorkspace,
								[wsId]: tabs.map((candidate) => (candidate === existing ? tab : candidate)),
							}
					: { ...s.tabsByWorkspace, [wsId]: [...tabs, tab] },
				activeTabByWorkspace: takesFocus
					? { ...s.activeTabByWorkspace, [wsId]: id }
					: s.activeTabByWorkspace,
				navTickByWorkspace: takesFocus ? bumpNav(s, wsId) : s.navTickByWorkspace,
				closedChatsByWorkspace: closed.some((c) => c.sessionId === summary.sessionId)
					? {
							...s.closedChatsByWorkspace,
							[wsId]: closed.filter((c) => c.sessionId !== summary.sessionId),
						}
					: s.closedChatsByWorkspace,
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
	setSessionGoalLoading: (sessionId, workspaceId) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, workspaceId, status: "loading", error: null },
			})),
		),
	setSessionGoalSaving: (sessionId, workspaceId) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, workspaceId, status: "saving", error: null },
			})),
		),
	setSessionGoal: (sessionId, value) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: {
					workspaceId: value.workspaceId,
					status: "ready",
					goal: value.goal,
					updatedAt: value.updatedAt,
					error: null,
				},
			})),
		),
	setSessionGoalError: (sessionId, workspaceId, error) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, workspaceId, status: "error", error },
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
				for (const [wsId, tabs] of Object.entries(s.tabsByWorkspace)) {
					const chat = tabs.find(
						(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === request.sessionId,
					);
					if (!chat) continue;
					if (chat.name === request.title) continue;
					return {
						tabsByWorkspace: {
							...s.tabsByWorkspace,
							[wsId]: tabs.map((tab) =>
								tab.id === chat.id ? { ...chat, name: request.title } : tab,
							),
						},
					};
				}
				for (const [wsId, chats] of Object.entries(s.closedChatsByWorkspace)) {
					if (!chats.some((chat) => chat.sessionId === request.sessionId)) continue;
					return {
						closedChatsByWorkspace: {
							...s.closedChatsByWorkspace,
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
	applyPiProfile: (profile) => set({ piProfile: profile }),
	requestToolView: (workspaceId, tool) =>
		set((state) =>
			state.removedWorkspaceIds[workspaceId]
				? {}
				: {
						activeActivityByWorkspace: {
							...state.activeActivityByWorkspace,
							[workspaceId]: tool === "changes" ? "changes" : "files",
						},
					},
		),
	requestChangesView: (workspaceId, path) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			return {
				activeActivityByWorkspace: {
					...s.activeActivityByWorkspace,
					[workspaceId]: "changes",
				},
				changesRequest: {
					workspaceId,
					path,
					navTick: selectWorkspaceNavTick(s, workspaceId) + 1,
				},
			};
		}),
	clearChangesRequest: () => set({ changesRequest: null }),
	requestChatLocation: (req) =>
		set((state) => {
			if (
				state.removedWorkspaceIds[req.workspaceId] ||
				isSessionDeleted(state, req.workspaceId, req.sessionId)
			) {
				return {};
			}
			return {
				chatLocationRequest: req,
				selectedProjectId: req.projectId,
				activeWorkspaceId: req.workspaceId,
			};
		}),
	clearChatLocation: () => set({ chatLocationRequest: null }),
	requestHistoryOpen: (target) =>
		set((s) => {
			if (
				s.removedWorkspaceIds[target.workspaceId] ||
				isSessionDeleted(s, target.workspaceId, target.sessionId)
			) {
				return {};
			}
			const cache = s.tabsByWorkspace[target.workspaceId]?.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === target.sessionId,
			);
			const historyRequestId = randomId("history-open");
			return {
				historyOpenRequest: { id: historyRequestId, sessionId: target.sessionId },
				activeTabByWorkspace: cache
					? { ...s.activeTabByWorkspace, [target.workspaceId]: cache.id }
					: s.activeTabByWorkspace,
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
