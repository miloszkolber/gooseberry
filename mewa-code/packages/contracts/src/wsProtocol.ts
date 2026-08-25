import type {
	AppConfig,
	AppConfigPatch,
	BranchList,
	DiffStats,
	ExistingWorktreeCandidate,
	FileNode,
	GitCommit,
	GitDiffScope,
	GitStatus,
	HistoryScope,
	HistorySearchResult,
	LoginReply,
	PiProfileDescriptor,
	Project,
	ProviderStatusReport,
	SessionGoal,
	Workspace,
} from "./domain";
import type {
	AskUserAnswersDetails,
	AskUserQuestionResult,
	ExtUiResponse,
	ImageContent,
	QueueLane,
	RefreshedModels,
	RemovedQueuedMessage,
	SessionQueueState,
	SessionStats,
	SessionSummary,
	SkillCatalogEntry,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireCustomMessage,
	WireModel,
} from "./piProtocol";

export const PROTOCOL_VERSION = 52;

export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	projects: Project[];
	recentProjects: Project[];
	config: AppConfig;
}

export interface WorkspaceRemoved {
	projectId: string;
	id: string;
}

export interface SessionDeletedPayload {
	workspaceId: string;
	sessionId: string;
}

export const WS_METHODS = {
	projectOpen: "project.open",
	projectList: "project.list",
	projectClose: "project.close",
	projectSetTrust: "project.setTrust",
	projectSetSkillEnabled: "project.setSkillEnabled",
	projectSetGroupEnabled: "project.setGroupEnabled",
	projectSkills: "project.skills",
	workspaceCreate: "workspace.create",
	workspaceListExisting: "workspace.listExisting",
	workspaceOpenExisting: "workspace.openExisting",
	workspaceList: "workspace.list",
	workspaceRemove: "workspace.remove",
	workspaceDiffStats: "workspace.diffStats",
	workspaceSetSkillOverride: "workspace.setSkillOverride",
	workspaceSetDiffBase: "workspace.setDiffBase",
	workspaceWatchReady: "workspace.watchReady",
	gitListBranches: "git.listBranches",
	gitPrefetch: "git.prefetch",
	fsReadDir: "fs.readDir",
	fsReadFile: "fs.readFile",
	gitStatus: "git.status",
	gitDiffFile: "git.diffFile",
	gitListCommits: "git.listCommits",
	dialogSelectDirectory: "dialog.selectDirectory",
	skillList: "skill.list",
	skillsState: "skills.state",
	sessionCreate: "session.create",
	sessionPrompt: "session.prompt",
	sessionSteer: "session.steer",
	sessionFollowUp: "session.followUp",
	sessionClearQueue: "session.clearQueue",
	sessionRemoveQueued: "session.removeQueued",
	sessionAbort: "session.abort",
	sessionDelete: "session.delete",
	sessionSetModel: "session.setModel",
	sessionSetThinkingLevel: "session.setThinkingLevel",
	sessionCompact: "session.compact",
	sessionGetStats: "session.getStats",
	sessionGetCommands: "session.getCommands",
	sessionReloadResources: "session.reloadResources",
	sessionExtUiReply: "session.extUiReply",
	sessionAnswerQuestion: "session.answerQuestion",
	sessionGoalGet: "session.goalGet",
	sessionGoalSet: "session.goalSet",
	sessionGoalClear: "session.goalClear",
	sessionList: "session.list",
	sessionGetMessages: "session.getMessages",
	modelList: "model.list",
	modelRefresh: "model.refresh",
	modelDefault: "model.default",
	modelClampThinking: "model.clampThinking",
	modelSetVisibility: "model.setVisibility",
	modelSetAllVisibility: "model.setAllVisibility",
	providerStatus: "provider.status",
	providerLoginStart: "provider.loginStart",
	providerLoginReply: "provider.loginReply",
	providerLoginCancel: "provider.loginCancel",
	providerLogout: "provider.logout",
	settingsProfile: "settings.profile",
	settingsUpdate: "settings.update",
	historySearch: "history.search",
} as const;

export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	projectUpdated: "project.updated",
	piEvent: "pi.event",
	piExtensionUi: "pi.extensionUi",
	sessionDeleted: "session.deleted",
	providerLogin: "provider.login",
	workspaceCreated: "workspace.created",
	workspaceUpdated: "workspace.updated",
	workspaceRemoved: "workspace.removed",
	workspaceFsChanged: "workspace.fsChanged",
	settingsChanged: "settings.changed",
} as const;

export type WsMethod = (typeof WS_METHODS)[keyof typeof WS_METHODS];
export type WsChannel = (typeof WS_CHANNELS)[keyof typeof WS_CHANNELS];

export const ASK_USER_ANSWERS_CUSTOM_TYPE = "ask-user-answers";

export interface AskUserAnswersMessage extends WireCustomMessage<AskUserAnswersDetails> {
	customType: typeof ASK_USER_ANSWERS_CUSTOM_TYPE;
	details: AskUserAnswersDetails;
}

export function isAskUserAnswersMessage(message: unknown): message is AskUserAnswersMessage {
	if (!message || typeof message !== "object") return false;
	const m = message as { role?: unknown; customType?: unknown; details?: unknown };
	if (m.role !== "custom" || m.customType !== ASK_USER_ANSWERS_CUSTOM_TYPE) return false;
	const details = m.details as Partial<AskUserAnswersDetails> | undefined;
	return (
		typeof details?.toolCallId === "string" &&
		!!details.result &&
		Array.isArray(details.result.answers) &&
		typeof details.result.cancelled === "boolean"
	);
}

export interface Ack {
	ok: true;
}

export interface WorkspaceWatchReadyResult {
	startupNudge: boolean;
}

export interface WsMethodMap {
	"project.open": { params: { path: string }; result: Project };
	"project.list": { params: Record<string, never>; result: Project[] };
	"project.close": { params: { id: string }; result: Ack };
	"project.setTrust": { params: { id: string; trusted: boolean }; result: Project };
	"project.setSkillEnabled": {
		params: { id: string; name: string; enabled: boolean };
		result: Project;
	};
	"project.setGroupEnabled": {
		params: { id: string; group: string; enabled: boolean };
		result: Project;
	};
	"project.skills": { params: { projectId: string }; result: SkillCatalogEntry[] };
	"workspace.create": {
		params: { projectId: string; name?: string; baseRef?: string };
		result: Workspace;
	};
	"workspace.listExisting": {
		params: { projectId: string };
		result: ExistingWorktreeCandidate[];
	};
	"workspace.openExisting": {
		params: { projectId: string; path: string };
		result: Workspace;
	};
	"workspace.list": {
		params: { projectId: string; includeDiffStats?: boolean };
		result: Workspace[];
	};
	"workspace.remove": { params: { id: string }; result: Ack };
	"workspace.diffStats": { params: { id: string }; result: DiffStats };
	"workspace.setSkillOverride": {
		params: { id: string; name: string; override: "on" | "off" | null };
		result: Workspace;
	};
	"workspace.setDiffBase": { params: { id: string; ref: string | null }; result: Workspace };
	"workspace.watchReady": {
		params: { workspaceId: string; prewarm?: boolean };
		result: WorkspaceWatchReadyResult;
	};
	"git.listBranches": { params: { projectId: string }; result: BranchList };
	"git.prefetch": { params: { projectId: string; ref: string }; result: { ok: boolean } };
	"fs.readDir": { params: { workspaceId: string; path: string }; result: FileNode[] };
	"fs.readFile": { params: { workspaceId: string; path: string }; result: { content: string } };
	"git.status": { params: { workspaceId: string; scope?: GitDiffScope }; result: GitStatus };
	"git.diffFile": {
		params: { workspaceId: string; path: string; scope?: GitDiffScope };
		result: { original: string; modified: string };
	};
	"git.listCommits": { params: { workspaceId: string }; result: { commits: GitCommit[] } };
	"dialog.selectDirectory": { params: Record<string, never>; result: { path: string | null } };
	"skill.list": { params: { projectId: string }; result: SlashCommandInfo[] };
	"skills.state": { params: { workspaceId: string }; result: SkillCatalogEntry[] };
	"session.create": {
		params: { workspaceId: string; model?: WireModel; thinkingLevel?: ThinkingLevel };
		result: { sessionId: string; model: WireModel | null; thinkingLevel: ThinkingLevel };
	};
	"session.prompt": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.steer": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.followUp": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.clearQueue": { params: { sessionId: string }; result: SessionQueueState };
	"session.removeQueued": {
		params: { sessionId: string; kind: QueueLane; index: number };
		result: RemovedQueuedMessage;
	};
	"session.abort": { params: { sessionId: string }; result: Ack };
	"session.delete": { params: { workspaceId: string; sessionId: string }; result: Ack };
	"session.setModel": { params: { sessionId: string; model: WireModel }; result: Ack };
	"session.setThinkingLevel": { params: { sessionId: string; level: ThinkingLevel }; result: Ack };
	"session.compact": { params: { sessionId: string; instructions?: string }; result: Ack };
	"session.getStats": { params: { sessionId: string }; result: SessionStats };
	"session.getCommands": { params: { sessionId: string }; result: SlashCommandInfo[] };
	"session.reloadResources": { params: { sessionId: string }; result: Ack };
	"session.extUiReply": { params: { response: ExtUiResponse }; result: Ack };
	"session.answerQuestion": {
		params: { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		result: Ack;
	};
	"session.goalGet": {
		params: { workspaceId: string; sessionId: string };
		result: SessionGoal;
	};
	"session.goalSet": {
		params: { workspaceId: string; sessionId: string; goal: string };
		result: SessionGoal;
	};
	"session.goalClear": {
		params: { workspaceId: string; sessionId: string };
		result: SessionGoal;
	};
	"session.list": { params: { workspaceId: string }; result: SessionSummary[] };
	"session.getMessages": {
		params: { sessionId: string; workspaceId: string };
		result: { summary: SessionSummary; messages: TranscriptMessage[] };
	};
	"model.list": { params: Record<string, never>; result: WireModel[] };
	"model.clampThinking": {
		params: { provider: string; id: string; level: ThinkingLevel };
		result: { level: ThinkingLevel };
	};
	"model.refresh": { params: { force?: boolean }; result: RefreshedModels };
	"model.default": {
		params: Record<string, never>;
		result: { model: WireModel | null; thinkingLevel: ThinkingLevel };
	};
	"model.setVisibility": {
		params: { provider: string; id: string; hidden: boolean };
		result: WireModel[];
	};
	"model.setAllVisibility": {
		params: { hidden: boolean };
		result: WireModel[];
	};
	"provider.status": { params: Record<string, never>; result: ProviderStatusReport };
	"provider.loginStart": {
		params: { providerId: string; type?: "oauth" | "api_key" };
		result: { loginId: string };
	};
	"provider.loginReply": { params: LoginReply; result: Ack };
	"provider.loginCancel": { params: { loginId: string }; result: Ack };
	"provider.logout": { params: { providerId: string }; result: Ack };
	"settings.profile": { params: Record<string, never>; result: PiProfileDescriptor };
	"settings.update": { params: { config: AppConfigPatch }; result: AppConfig };
	"history.search": {
		params: { query: string; scope: HistoryScope; limit?: number };
		result: HistorySearchResult;
	};
}

export type WsMethodName = keyof WsMethodMap;
export type WsParams<M extends WsMethodName> = WsMethodMap[M]["params"];
export type WsResult<M extends WsMethodName> = WsMethodMap[M]["result"];

export interface WsRequest<M extends WsMethodName = WsMethodName> {
	id: string;
	method: M;
	params: WsParams<M>;
	sessionId?: string;
}

export interface WsAck {
	ack: string[];
}

export interface WsResume {
	resume: string[];
}

export type WsClientMessage = WsRequest | WsAck | WsResume;

export type WsErrorCode = "UNKNOWN_COMMIT";

export interface WsResponse {
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
	errorCode?: WsErrorCode;
}

export interface WsPush {
	channel: WsChannel;
	data: unknown;
}

export type WsServerMessage = WsResponse | WsPush;
