import type {
	AskUserQuestionResult,
	ImageContent,
	PermissionRequest,
	QueueLane,
	RefreshedModels,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "./agent-protocol";
import type {
	AgentMentionInfo,
	AppConfig,
	AppConfigPatch,
	DirectoryListing,
	FileNode,
	GitCommit,
	GitDiffFile,
	GitDiffScope,
	GitRepository,
	GooseExtensionCatalog,
	GooseExtensionSummary,
	GooseToolPermission,
	GooseToolSummary,
	HistoryScope,
	HistorySearchResult,
	LoginFrame,
	LoginReply,
	Project,
	ProviderStatusReport,
	SessionGoal,
	SignetStatus,
} from "./domain";

export const PROTOCOL_VERSION = 63;

/**
 * Maximum UTF-8 byte length for one serialized browser WebSocket request.
 * This leaves 8 MiB for JSON framing and metadata above the 24 MiB accepted
 * aggregate base64 image budget.
 */
export const MAX_SERIALIZED_WS_REQUEST_BYTES = 32 * 1024 * 1024;

export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	projects: Project[];
	recentProjects: Project[];
	config: AppConfig;
	gooseStatus?: { configured: boolean; reachable: boolean; error?: string; version?: string };
	/** Authenticated, bounded snapshot used to restore outstanding approvals after reconnecting. */
	pendingPermissions: PermissionRequest[];
}

export interface SessionDeletedPayload {
	projectId: string;
	sessionId: string;
}
export interface PermissionResolvedPayload {
	sessionId: string;
	permissionId: string;
}

export const WS_METHODS = {
	projectOpen: "project.open",
	projectAddRoot: "project.addRoot",
	projectRemoveRoot: "project.removeRoot",
	projectUpdate: "project.update",
	projectList: "project.list",
	projectClose: "project.close",
	projectWatchReady: "project.watchReady",
	gitListRepositories: "git.listRepositories",
	fsReadDir: "fs.readDir",
	fsReadFile: "fs.readFile",
	gitStatus: "git.status",
	gitDiffFile: "git.diffFile",
	gitListCommits: "git.listCommits",
	directoryList: "directory.list",
	skillList: "skill.list",
	sessionCreate: "session.create",
	sessionFork: "session.fork",
	sessionPrompt: "session.prompt",
	sessionSteer: "session.steer",
	sessionQueueAdd: "session.queueAdd",
	sessionQueueEdit: "session.queueEdit",
	sessionQueueRemove: "session.queueRemove",
	sessionAbort: "session.abort",
	sessionPermissionReply: "session.permissionReply",
	sessionDelete: "session.delete",
	sessionRename: "session.rename",
	sessionArchive: "session.archive",
	sessionUnarchive: "session.unarchive",
	sessionSetModel: "session.setModel",
	sessionSetThinkingLevel: "session.setThinkingLevel",
	sessionGetStats: "session.getStats",
	sessionGetCommands: "session.getCommands",
	sessionGetAgentMentions: "session.getAgentMentions",
	sessionGoalGet: "session.goalGet",
	sessionGoalSet: "session.goalSet",
	sessionGoalClear: "session.goalClear",
	sessionQuestionReply: "session.questionReply",
	sessionList: "session.list",
	sessionGetMessages: "session.getMessages",
	modelList: "model.list",
	modelRefresh: "model.refresh",
	modelDefault: "model.default",
	modelClampThinking: "model.clampThinking",
	modelSetVisibility: "model.setVisibility",
	modelSetAllVisibility: "model.setAllVisibility",
	providerStatus: "provider.status",
	providerReadiness: "provider.readiness",
	providerLoginStart: "provider.loginStart",
	providerLoginReply: "provider.loginReply",
	providerLoginCancel: "provider.loginCancel",
	providerLogout: "provider.logout",
	settingsUpdate: "settings.update",
	signetStatus: "signet.status",
	historySearch: "history.search",
	gooseRecipeList: "goose.recipeList",
	gooseRecipeSave: "goose.recipeSave",
	gooseRecipeDelete: "goose.recipeDelete",
	gooseRecipeParse: "goose.recipeParse",
	gooseScheduleList: "goose.scheduleList",
	gooseScheduleCreate: "goose.scheduleCreate",
	gooseScheduleUpdate: "goose.scheduleUpdate",
	gooseSchedulePause: "goose.schedulePause",
	gooseScheduleResume: "goose.scheduleResume",
	gooseScheduleDelete: "goose.scheduleDelete",
	gooseScheduleRunNow: "goose.scheduleRunNow",
	gooseScheduleSessions: "goose.scheduleSessions",
	gooseScheduleInspect: "goose.scheduleInspect",
	gooseScheduleKill: "goose.scheduleKill",
	gooseStatus: "goose.status",
	gooseExtensionList: "goose.extensionList",
	gooseExtensionAdd: "goose.extensionAdd",
	gooseExtensionSetEnabled: "goose.extensionSetEnabled",
	gooseExtensionRemove: "goose.extensionRemove",
	sessionExtensionList: "session.extensionList",
	sessionExtensionAdd: "session.extensionAdd",
	sessionExtensionRemove: "session.extensionRemove",
	sessionToolList: "session.toolList",
	sessionToolPermissionSet: "session.toolPermissionSet",
} as const;

export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	projectUpdated: "project.updated",
	agentEvent: "agent.event",
	sessionDeleted: "session.deleted",
	sessionLifecycleChanged: "session.lifecycleChanged",
	providerLogin: "provider.login",
	projectFsChanged: "project.fsChanged",
	settingsChanged: "settings.changed",
	permissionRequest: "session.permissionRequest",
	permissionResolved: "session.permissionResolved",
	sessionObjectiveChanged: "session.objectiveChanged",
} as const;

export type WsMethod = (typeof WS_METHODS)[keyof typeof WS_METHODS];
export type WsChannel = (typeof WS_CHANNELS)[keyof typeof WS_CHANNELS];

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
	"project.update": {
		params: { id: string; name?: string; icon?: Project["icon"] };
		result: Project;
	};
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
		result: GitDiffFile;
	};
	"git.listCommits": {
		params: { projectId: string; repository: string };
		result: { commits: GitCommit[] };
	};
	"directory.list": {
		params: { path?: string; page?: number; pageSize?: number; includeHidden?: boolean };
		result: DirectoryListing;
	};
	"skill.list": { params: { projectId: string }; result: SlashCommandInfo[] };
	"session.create": {
		params: { projectId: string; cwd?: string; model?: WireModel; thinkingLevel?: ThinkingLevel };
		result: { sessionId: string; model: WireModel | null; thinkingLevel: ThinkingLevel };
	};
	"session.fork": {
		params: { projectId: string; sessionId: string };
		result: SessionSummary;
	};
	"session.prompt": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.steer": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.queueAdd": { params: { sessionId: string; text: string }; result: Ack };
	"session.queueEdit": {
		params: { sessionId: string; lane: QueueLane; index: number; text: string };
		result: Ack;
	};
	"session.queueRemove": {
		params: { sessionId: string; lane: QueueLane; index: number };
		result: Ack;
	};
	"session.abort": { params: { sessionId: string }; result: Ack };
	"session.permissionReply": {
		params: { sessionId: string; permissionId: string; optionId?: string };
		result: Ack;
	};
	"session.delete": { params: { projectId: string; sessionId: string }; result: Ack };
	"session.rename": {
		params: { projectId: string; sessionId: string; title: string };
		result: Ack;
	};
	"session.archive": { params: { projectId: string; sessionId: string }; result: Ack };
	"session.unarchive": { params: { projectId: string; sessionId: string }; result: Ack };
	"session.setModel": { params: { sessionId: string; model: WireModel }; result: Ack };
	"session.setThinkingLevel": { params: { sessionId: string; level: ThinkingLevel }; result: Ack };
	"session.getStats": { params: { sessionId: string }; result: SessionStats };
	"session.getCommands": { params: { sessionId: string }; result: SlashCommandInfo[] };
	"session.getAgentMentions": {
		params: { projectId: string; sessionId: string };
		result: AgentMentionInfo[];
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
	"session.questionReply": {
		params: { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		result: Ack;
	};
	"session.list": {
		params: { projectId: string; archived?: boolean | "all" };
		result: SessionSummary[];
	};
	"session.getMessages": {
		params: { sessionId: string; projectId: string };
		result: { summary: SessionSummary; messages: TranscriptMessage[] };
	};
	"model.list": { params: Record<string, never>; result: WireModel[] };
	"model.clampThinking": {
		params: { sessionId: string; level: ThinkingLevel };
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
	"provider.readiness": {
		params: { providerId: string };
		result: { providerId: string; ready: boolean; hasIssue: boolean };
	};
	"provider.loginStart": {
		params: { providerId: string; type?: "oauth" | "api_key" };
		result: { loginId: string; frame: LoginFrame };
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
	"goose.recipeList": { params: Record<string, never>; result: unknown[] };
	"goose.recipeSave": {
		params: { recipe: Record<string, unknown>; id?: string };
		result: { id: string; fileName: string; filePath: string };
	};
	"goose.recipeDelete": { params: { id: string }; result: Ack };
	"goose.recipeParse": { params: { content: string }; result: unknown };
	"goose.scheduleList": { params: Record<string, never>; result: unknown[] };
	"goose.scheduleCreate": {
		params: { id: string; recipe: Record<string, unknown>; cron: string };
		result: unknown;
	};
	"goose.scheduleUpdate": { params: { scheduleId: string; cron: string }; result: unknown };
	"goose.schedulePause": { params: { scheduleId: string }; result: Ack };
	"goose.scheduleResume": { params: { scheduleId: string }; result: Ack };
	"goose.scheduleDelete": { params: { scheduleId: string }; result: Ack };
	"goose.scheduleRunNow": {
		params: { scheduleId: string };
		result: { status: string; sessionId?: string };
	};
	"goose.scheduleSessions": { params: { scheduleId: string; limit?: number }; result: unknown[] };
	"goose.scheduleInspect": {
		params: { scheduleId: string };
		result: {
			running: boolean;
			sessionId?: string;
			jobStartTime?: string;
			runningDurationSeconds?: number;
		};
	};
	"goose.scheduleKill": {
		params: { scheduleId: string };
		result: { message: string };
	};
	"goose.status": {
		params: Record<string, never>;
		result: { configured: boolean; reachable: boolean; error?: string; version?: string };
	};
	"goose.extensionList": { params: Record<string, never>; result: GooseExtensionCatalog };
	"goose.extensionAdd": {
		params: { name: string; enabled: boolean };
		result: GooseExtensionCatalog;
	};
	"goose.extensionSetEnabled": {
		params: { configKey: string; enabled: boolean };
		result: GooseExtensionCatalog;
	};
	"goose.extensionRemove": { params: { configKey: string }; result: GooseExtensionCatalog };
	"session.extensionList": {
		params: { projectId: string; sessionId: string };
		result: GooseExtensionSummary[];
	};
	"session.extensionAdd": {
		params: { projectId: string; sessionId: string; name: string };
		result: GooseExtensionSummary[];
	};
	"session.extensionRemove": {
		params: { projectId: string; sessionId: string; name: string };
		result: GooseExtensionSummary[];
	};
	"session.toolList": {
		params: { projectId: string; sessionId: string };
		result: GooseToolSummary[];
	};
	"session.toolPermissionSet": {
		params: {
			projectId: string;
			sessionId: string;
			toolName: string;
			permission: GooseToolPermission;
		};
		result: GooseToolSummary[];
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
