import type {
	AppConfig,
	AppConfigPatch,
	FileNode,
	GitCommit,
	GitDiffScope,
	GitRepository,
	HistoryScope,
	HistorySearchResult,
	LoginReply,
	Project,
	ProviderStatusReport,
	SessionGoal,
	SignetStatus,
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
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireCustomMessage,
	WireModel,
} from "./pi-protocol";

export const PROTOCOL_VERSION = 53;

export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	projects: Project[];
	recentProjects: Project[];
	config: AppConfig;
}

export interface SessionDeletedPayload {
	projectId: string;
	sessionId: string;
}

export const WS_METHODS = {
	projectOpen: "project.open",
	projectAddRoot: "project.addRoot",
	projectRemoveRoot: "project.removeRoot",
	projectList: "project.list",
	projectClose: "project.close",
	projectWatchReady: "project.watchReady",
	gitListRepositories: "git.listRepositories",
	fsReadDir: "fs.readDir",
	fsReadFile: "fs.readFile",
	gitStatus: "git.status",
	gitDiffFile: "git.diffFile",
	gitListCommits: "git.listCommits",
	dialogSelectDirectory: "dialog.selectDirectory",
	skillList: "skill.list",
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
	sessionTasksSet: "session.tasksSet",
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
	settingsUpdate: "settings.update",
	signetStatus: "signet.status",
	historySearch: "history.search",
} as const;

export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	projectUpdated: "project.updated",
	piEvent: "pi.event",
	piExtensionUi: "pi.extensionUi",
	sessionDeleted: "session.deleted",
	providerLogin: "provider.login",
	projectFsChanged: "project.fsChanged",
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

export interface ProjectWatchReadyResult {
	startupNudge: boolean;
}

export interface WsMethodMap {
	"project.open": { params: { path: string }; result: Project };
	"project.addRoot": { params: { id: string; path: string }; result: Project };
	"project.removeRoot": { params: { id: string; path: string }; result: Project };
	"project.list": { params: Record<string, never>; result: Project[] };
	"project.close": { params: { id: string }; result: Ack };
	"project.watchReady": {
		params: { projectId: string; prewarm?: boolean };
		result: ProjectWatchReadyResult;
	};
	"git.listRepositories": { params: { projectId: string }; result: GitRepository[] };
	"fs.readDir": { params: { projectId: string; root: string; path: string }; result: FileNode[] };
	"fs.readFile": {
		params: { projectId: string; root: string; path: string };
		result: { content: string };
	};
	"git.status": {
		params: { projectId: string; repository: string };
		result: GitRepository;
	};
	"git.diffFile": {
		params: { projectId: string; repository: string; path: string; scope?: GitDiffScope };
		result: { original: string; modified: string };
	};
	"git.listCommits": {
		params: { projectId: string; repository: string };
		result: { commits: GitCommit[] };
	};
	"dialog.selectDirectory": { params: Record<string, never>; result: { path: string | null } };
	"skill.list": { params: { projectId: string }; result: SlashCommandInfo[] };
	"session.create": {
		params: { projectId: string; cwd?: string; model?: WireModel; thinkingLevel?: ThinkingLevel };
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
	"session.delete": { params: { projectId: string; sessionId: string }; result: Ack };
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
		params: { projectId: string; sessionId: string };
		result: SessionGoal;
	};
	"session.goalSet": {
		params: { projectId: string; sessionId: string; goal: string };
		result: SessionGoal;
	};
	"session.goalClear": {
		params: { projectId: string; sessionId: string };
		result: SessionGoal;
	};
	"session.tasksSet": {
		params: { projectId: string; sessionId: string; tasks: SessionGoal["tasks"] };
		result: SessionGoal;
	};
	"session.list": { params: { projectId: string }; result: SessionSummary[] };
	"session.getMessages": {
		params: { sessionId: string; projectId: string };
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
	"settings.update": { params: { config: AppConfigPatch }; result: AppConfig };
	"signet.status": { params: Record<string, never>; result: SignetStatus };
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
