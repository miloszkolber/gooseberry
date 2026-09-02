import type {
	AskUserQuestionResult,
	ImageContent,
	McpAppContentChunk,
	McpAppOpenResult,
	McpAppResourceResult,
	McpAppToolResult,
	PendingToolPreview,
	PermissionRequest,
	QueueLane,
	RefreshedModels,
	SessionModeState,
	SessionPlanState,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "./agent-protocol";
import type {
	AgentMentionInfo,
	AgentProfile,
	AppConfig,
	AppConfigPatch,
	DirectoryListing,
	FileListing,
	GitBranchRef,
	GitCommit,
	GitDiffFile,
	GitDiffScope,
	GitRepository,
	GitRepositoryList,
	GooseAgentCatalogEntry,
	GooseAutomationJobInspection,
	GooseAutomationRecipe,
	GooseAutomationRecipeEntry,
	GooseAutomationSchedule,
	GooseAutomationSession,
	GooseExtensionCatalog,
	GooseExtensionSummary,
	GoosePreferences,
	GooseProviderDefaults,
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

export const PROTOCOL_VERSION = 78;

/**
 * Maximum UTF-8 byte length for one serialized browser WebSocket request.
 * This leaves 8 MiB for JSON framing and metadata above the 24 MiB accepted
 * aggregate base64 image budget.
 */
export const MAX_SERIALIZED_WS_REQUEST_BYTES = 32 * 1024 * 1024;

export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	agentProfile?: AgentProfile;
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
	gitListBranches: "git.listBranches",
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
	sessionQueueRetry: "session.queueRetry",
	sessionAbort: "session.abort",
	sessionPermissionReply: "session.permissionReply",
	sessionDelete: "session.delete",
	sessionRename: "session.rename",
	sessionArchive: "session.archive",
	sessionUnarchive: "session.unarchive",
	sessionSetModel: "session.setModel",
	sessionSetThinkingLevel: "session.setThinkingLevel",
	sessionSetMode: "session.setMode",
	sessionGetStats: "session.getStats",
	sessionGetCommands: "session.getCommands",
	sessionGetAgentMentions: "session.getAgentMentions",
	sessionGoalGet: "session.goalGet",
	sessionGoalSet: "session.goalSet",
	sessionGoalClear: "session.goalClear",
	sessionQuestionReply: "session.questionReply",
	sessionList: "session.list",
	sessionGetMessages: "session.getMessages",
	sessionSetLeases: "session.setLeases",
	sessionRelease: "session.release",
	sessionAppOpen: "session.appOpen",
	sessionAppContentRead: "session.appContentRead",
	sessionAppKeepAlive: "session.appKeepAlive",
	sessionAppClose: "session.appClose",
	sessionAppResourceRead: "session.appResourceRead",
	sessionAppToolCall: "session.appToolCall",
	sessionAppOperationCancel: "session.appOperationCancel",
	modelList: "model.list",
	modelRefresh: "model.refresh",
	modelDefault: "model.default",
	modelClampThinking: "model.clampThinking",
	modelSetVisibility: "model.setVisibility",
	modelSetAllVisibility: "model.setAllVisibility",
	goosePreferencesRead: "goose.preferencesRead",
	goosePreferencesSave: "goose.preferencesSave",
	goosePreferencesReset: "goose.preferencesReset",
	gooseDefaultsRead: "goose.defaultsRead",
	gooseDefaultsSave: "goose.defaultsSave",
	gooseDefaultsClear: "goose.defaultsClear",
	gooseAgentList: "goose.agentList",
	gooseAgentCreate: "goose.agentCreate",
	gooseAgentUpdate: "goose.agentUpdate",
	gooseAgentDelete: "goose.agentDelete",
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
	agentProfileChanged: "agent.profileChanged",
	projectUpdated: "project.updated",
	agentEvent: "agent.event",
	sessionDeleted: "session.deleted",
	sessionLifecycleChanged: "session.lifecycleChanged",
	providerLogin: "provider.login",
	projectFsChanged: "project.fsChanged",
	commandCatalogChanged: "goose.commandCatalogChanged",
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

export interface TranscriptPage {
	projectionId: string;
	start: number;
	total: number;
}

export type SessionMessagesResult =
	| {
			kind: "snapshot";
			summary: SessionSummary;
			messages: TranscriptMessage[];
			pendingTools: PendingToolPreview[];
			commands: SlashCommandInfo[];
			modes: SessionModeState | null;
			planState: SessionPlanState | null;
			page: TranscriptPage;
	  }
	| {
			kind: "page";
			messages: TranscriptMessage[];
			page: TranscriptPage;
	  };

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
	"git.listRepositories": { params: { projectId: string }; result: GitRepositoryList };
	"fs.readDir": { params: { projectId: string; root: string; path: string }; result: FileListing };
	"fs.readFile": {
		params: { projectId: string; root: string; path: string };
		result: { content: string };
	};
	"git.status": {
		params: { projectId: string; repository: string; scope?: GitDiffScope };
		result: GitRepository;
	};
	"git.diffFile": {
		params: { projectId: string; repository: string; path: string; scope?: GitDiffScope };
		result: GitDiffFile;
	};
	"git.listBranches": {
		params: { projectId: string; repository: string };
		result: { branches: GitBranchRef[]; truncated: boolean };
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
		result: {
			sessionId: string;
			model: WireModel | null;
			thinkingLevel: ThinkingLevel;
			commands: SlashCommandInfo[];
			modes: SessionModeState | null;
		};
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
		params: { sessionId: string; lane: QueueLane; index: number; text: string; revision: string };
		result: Ack;
	};
	"session.queueRemove": {
		params: { sessionId: string; lane: QueueLane; index: number; revision: string };
		result: Ack;
	};
	"session.queueRetry": {
		params: { sessionId: string; lane: QueueLane; index: number; revision: string };
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
	"session.setMode": { params: { sessionId: string; modeId: string }; result: Ack };
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
		params:
			| { sessionId: string; projectId: string }
			| {
					sessionId: string;
					projectId: string;
					before: { projectionId: string; index: number };
			  };
		result: SessionMessagesResult;
	};
	"session.release": { params: { sessionId: string; projectId: string }; result: Ack };
	"session.appOpen": {
		params: { projectId: string; sessionId: string; toolCallId: string; parentOrigin: string };
		result: McpAppOpenResult;
	};
	"session.appContentRead": {
		params: {
			projectId: string;
			sessionId: string;
			toolCallId: string;
			viewId: string;
			offset: number;
		};
		result: McpAppContentChunk;
	};
	"session.appKeepAlive": {
		params: { projectId: string; sessionId: string; toolCallId: string; viewId: string };
		result: Ack;
	};
	"session.appClose": { params: { viewId: string }; result: Ack };
	"session.appResourceRead": {
		params: {
			projectId: string;
			sessionId: string;
			toolCallId: string;
			viewId: string;
			operationId: string;
			uri: string;
		};
		result: McpAppResourceResult;
	};
	"session.appToolCall": {
		params: {
			projectId: string;
			sessionId: string;
			toolCallId: string;
			viewId: string;
			operationId: string;
			name: string;
			arguments?: Record<string, unknown>;
		};
		result: McpAppToolResult;
	};
	"session.appOperationCancel": {
		params: { viewId: string; operationId: string };
		result: Ack;
	};
	/** Complete open-tab snapshot for this browser; older revisions are ignored. */
	"session.setLeases": {
		params: { revision: number; sessions: { projectId: string; sessionId: string }[] };
		result: Ack;
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
	"goose.preferencesRead": { params: Record<string, never>; result: GoosePreferences };
	"goose.preferencesSave": { params: GoosePreferences; result: GoosePreferences };
	"goose.preferencesReset": {
		params: { keys: ("autoCompactThreshold" | "gooseThinkingEffort")[] };
		result: GoosePreferences;
	};
	"goose.defaultsRead": { params: Record<string, never>; result: GooseProviderDefaults };
	"goose.defaultsSave": {
		params: { providerId: string; modelId: string | null };
		result: GooseProviderDefaults;
	};
	"goose.defaultsClear": { params: Record<string, never>; result: GooseProviderDefaults };
	"goose.agentList": {
		params: { projectId?: string; root?: string };
		result: GooseAgentCatalogEntry[];
	};
	"goose.agentCreate": {
		params: {
			name: string;
			description: string;
			instructions: string;
			scope: "global" | "project";
			projectId?: string;
			root?: string;
			modelId?: string;
		};
		result: GooseAgentCatalogEntry;
	};
	"goose.agentUpdate": {
		params: {
			id: string;
			name: string;
			description: string;
			instructions: string;
			projectId?: string;
			root?: string;
			modelId?: string | null;
		};
		result: GooseAgentCatalogEntry;
	};
	"goose.agentDelete": {
		params: { id: string; projectId?: string; root?: string };
		result: Ack;
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
	"goose.recipeList": { params: Record<string, never>; result: GooseAutomationRecipeEntry[] };
	"goose.recipeSave": {
		params: { recipe: GooseAutomationRecipe; id?: string };
		result: { id: string; fileName: string; filePath: string };
	};
	"goose.recipeDelete": { params: { id: string }; result: Ack };
	"goose.recipeParse": { params: { content: string }; result: GooseAutomationRecipe };
	"goose.scheduleList": { params: Record<string, never>; result: GooseAutomationSchedule[] };
	"goose.scheduleCreate": {
		params: { id: string; recipe: GooseAutomationRecipe; cron: string };
		result: GooseAutomationSchedule;
	};
	"goose.scheduleUpdate": {
		params: { scheduleId: string; cron: string };
		result: GooseAutomationSchedule;
	};
	"goose.schedulePause": { params: { scheduleId: string }; result: Ack };
	"goose.scheduleResume": { params: { scheduleId: string }; result: Ack };
	"goose.scheduleDelete": { params: { scheduleId: string }; result: Ack };
	"goose.scheduleRunNow": {
		params: { scheduleId: string };
		result: { status: string; sessionId?: string };
	};
	"goose.scheduleSessions": {
		params: { scheduleId: string; limit?: number };
		result: GooseAutomationSession[];
	};
	"goose.scheduleInspect": {
		params: { scheduleId: string };
		result: GooseAutomationJobInspection;
	};
	"goose.scheduleKill": {
		params: { scheduleId: string };
		result: { message: string };
	};
	"goose.status": {
		params: Record<string, never>;
		result: {
			configured: boolean;
			reachable: boolean;
			error?: string;
			version?: string;
			agentProfile?: AgentProfile;
		};
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

export type WsErrorCode =
	| "UNKNOWN_COMMIT"
	| "UNKNOWN_BRANCH"
	| "SYMBOLIC_BRANCH"
	| "UNBORN_HEAD"
	| "NO_MERGE_BASE"
	| "GIT_BRANCHES_UNAVAILABLE"
	| "UNSUPPORTED_AGENT_CAPABILITY"
	| "STALE_TRANSCRIPT_PROJECTION";

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
