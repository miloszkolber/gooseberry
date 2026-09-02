/** Browser-safe operations available through the connected ACP agent. */
export interface AgentOperations {
	deleteSession: boolean;
	forkSession: boolean;
	promptImage: boolean;
	httpMcp: boolean;
	steer: boolean;
	renameSession: boolean;
	archiveSession: boolean;
	administration: boolean;
}

/** Connection-scoped identity and capabilities; never includes raw ACP metadata. */
export interface AgentProfile {
	name: string;
	version: string;
	goose: boolean;
	compatible: boolean;
	missingRequired: string[];
	operations: AgentOperations;
}

export type RuntimeAvailability = "ready" | "degraded" | "unavailable";

export interface RuntimeBuild {
	version: string;
	revision?: string;
}

export interface RuntimeRequestMetrics {
	total: number;
	failures: number;
	active: number;
	averageMs: number;
	maxMs: number;
}

export interface RuntimeProcessMetrics {
	uptimeSeconds: number;
	goroutines: number;
	heapBytes: number;
	gcCycles: number;
}

/** Browser-safe local service status; unavailable services omit runtime metrics. */
export interface RuntimeServiceStatus {
	state: RuntimeAvailability;
	build?: RuntimeBuild;
	requests?: RuntimeRequestMetrics;
	process?: RuntimeProcessMetrics;
	detail?: string;
}

/** Browser-safe agent identity and availability without upstream diagnostics. */
export interface RuntimeAgentStatus {
	state: RuntimeAvailability;
	name?: string;
	version?: string;
	detail?: string;
}

export interface RuntimeStatusReport {
	application: RuntimeServiceStatus;
	agent: RuntimeAgentStatus;
	browser: RuntimeServiceStatus;
}

/** Browser-safe projection of Goose's globally persisted tool permission. */
export type GooseToolPermission = "always_allow" | "ask_before" | "never_allow";

/** Deliberately excludes Goose extension configuration, raw objects, and MCP credentials. */
export interface GooseExtensionSummary {
	name: string;
	type: "builtin" | "platform" | "mcp";
	displayName?: string;
	description?: string;
	bundled?: boolean;
	availableTools?: string[];
}

/** Config state appears only in the configured catalog collection. */
export interface GooseConfiguredExtensionSummary extends GooseExtensionSummary {
	enabled: boolean;
	configKey?: string;
}

export interface GooseExtensionCatalog {
	configured: GooseConfiguredExtensionSummary[];
	available: GooseExtensionSummary[];
	warningCount: number;
}

/** Deliberately excludes input/output schemas and any extension implementation metadata. */
export interface GooseToolSummary {
	name: string;
	description: string;
	parameters: string[];
	permission?: GooseToolPermission;
}

/** Browser-safe projections of Goose-owned recipe and scheduler state. */
export type GooseAutomationRecipe = {
	title: string;
	description: string;
	[key: string]: unknown;
};

export interface GooseAutomationRecipeEntry {
	id: string;
	recipe: GooseAutomationRecipe;
	filePath: string;
	lastModified: string;
	scheduleCron?: string;
	slashCommand?: string;
}

export interface GooseAutomationSchedule {
	id: string;
	source: string;
	cron: string;
	lastRun?: string;
	currentlyRunning: boolean;
	paused: boolean;
	currentSessionId?: string;
	jobStartTime?: string;
}

export interface GooseAutomationSession {
	id?: string;
	sessionId?: string;
	title?: string;
}

export interface GooseAutomationJobInspection {
	running: boolean;
	sessionId?: string;
	jobStartTime?: string;
	runningDurationSeconds?: number;
}

export const PROJECT_ICONS = ["folder", "code", "book", "flask", "rocket", "sparkles"] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];
export const PROJECT_NAME_MAX_LENGTH = 100;

export function normalizeProjectName(value: unknown): string {
	if (typeof value !== "string") throw new Error("Project name must be text");
	const name = value.trim();
	if (!name) throw new Error("Project name cannot be empty");
	if (name.includes("\0")) throw new Error("Project name contains an invalid character");
	if (name.length > PROJECT_NAME_MAX_LENGTH) {
		throw new Error(`Project name must be ${PROJECT_NAME_MAX_LENGTH} characters or fewer`);
	}
	return name;
}

export function normalizeProjectIcon(value: unknown): ProjectIcon {
	if (typeof value !== "string" || !(PROJECT_ICONS as readonly string[]).includes(value)) {
		throw new Error("Unknown project icon");
	}
	return value as ProjectIcon;
}

export interface Project {
	id: string;
	name: string;
	roots: string[];
	slug: string;
	lastOpened: number;
	icon?: ProjectIcon;
	closed?: true;
}

export interface ProjectFsChange {
	root: string;
	path: string;
}

export interface ProjectFsChangedPayload {
	projectId: string;
	changes: ProjectFsChange[];
	truncated: boolean;
}

export interface SessionGoal {
	projectId: string;
	sessionId: string;
	goal: string | null;
	tasks: SessionTask[];
	updatedAt: number | null;
}

export type SessionTaskStatus = "pending" | "active" | "done";

export interface SessionTask {
	id: string;
	text: string;
	status: SessionTaskStatus;
}

export const SESSION_GOAL_MAX_LENGTH = 2_000;

export function normalizeSessionGoal(value: unknown): string {
	if (typeof value !== "string") throw new Error("Session goal must be text");
	const goal = value.trim();
	if (!goal) throw new Error("Session goal cannot be empty");
	if (goal.includes("\0")) throw new Error("Session goal contains an invalid character");
	if (goal.length > SESSION_GOAL_MAX_LENGTH) {
		throw new Error(`Session goal must be ${SESSION_GOAL_MAX_LENGTH} characters or fewer`);
	}
	return goal;
}

export type FileKind = "file" | "dir";

export interface FileNode {
	path: string;
	name: string;
	kind: FileKind;
	gitignored?: boolean;
	children?: FileNode[];
}

export interface FileListing {
	nodes: FileNode[];
	complete: boolean;
	warnings: string[];
}

/** A directory admitted for selection by the browser directory picker. */
export interface DirectoryEntry {
	name: string;
	path: string;
}

export interface DirectoryListing {
	/** Null when choosing one of the configured mount roots. */
	path: string | null;
	roots: string[];
	directories: DirectoryEntry[];
	page: number;
	pageSize: number;
	hasMore: boolean;
	complete: boolean;
	warnings: string[];
	/** Opaque continuation marker for clients that do not want to derive a page number. */
	cursor: string | null;
}

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitFileChange {
	path: string;
	originalPath?: string;
	status: GitFileStatus;
	added?: number;
	removed?: number;
}

export type GitHead =
	| { kind: "branch"; name: string }
	| { kind: "detached"; oid: string }
	| { kind: "unborn" };

export interface GitRepository {
	id: string;
	root: string;
	relativePath: string;
	name: string;
	head: GitHead;
	clean: boolean;
	changes: GitFileChange[];
	comparisonId?: string;
}

export interface GitRepositoryList {
	repositories: GitRepository[];
	complete: boolean;
	warnings: string[];
}

export interface GitBranchRef {
	ref: string;
	name: string;
}

export type GitDiffScope =
	| { kind: "branch"; baseRef: string }
	| { kind: "uncommitted" }
	| { kind: "commit"; sha: string }
	| { kind: "pinned"; baseRef: string };

/** A bounded Git file preview. Unavailable previews never include file content. */
export interface GitDiffFile {
	original: string;
	modified: string;
	originalPath?: string;
	comparisonId?: string;
	unavailable?: true;
	binary?: true;
	tooLarge?: true;
	message?: string;
}

export interface GitCommit {
	sha: string;
	shortSha: string;
	subject: string;
	author: string;
	committedAt: string;
}

export type ProviderAuthKind = "oauth" | "api-key" | "env" | "other";

export interface ProviderStatus {
	id: string;
	name: string;
	configured: boolean;
	/** Whether Goose reports that this configured provider can run. */
	available?: boolean;
	kind?: ProviderAuthKind;
	detail?: string;
	canOAuth?: boolean;
	canApiKey?: boolean;
	canLogout?: boolean;
	modelCount: number;
	availableModelCount: number;
	/** Goose inventory marks providers that support ACP readiness checks. */
	acp: boolean;
}

export interface ProviderStatusReport {
	providers: ProviderStatus[];
}

/** Browser-safe agent completion data. Source paths and raw ACP values stay server-side. */
export interface AgentMentionInfo {
	name: string;
	description: string;
	sourceType: "skill" | "builtinSkill" | "recipe" | "subrecipe" | "agent" | "project";
	mention: string;
}

/** The focused, allowlisted Goose preference projection. */
export interface GoosePreferences {
	autoCompactThreshold?: number;
	gooseThinkingEffort?: "off" | "low" | "medium" | "high" | "max";
}

/** Goose's global provider/model default, never persisted by Gooseberry. */
export interface GooseProviderDefaults {
	providerId: string | null;
	modelId: string | null;
}

/** Opaque catalog identity. Paths and arbitrary source properties never cross this boundary. */
export interface GooseAgentCatalogEntry {
	id: string;
	name: string;
	description: string;
	instructions: string;
	scope: "global" | "project";
	writable: boolean;
	/** Goose supports model ID preference only. The agent inherits its provider. */
	modelId?: string;
}

export type LoginFrame =
	| { kind: "authUrl"; url: string; instructions?: string }
	| { kind: "deviceCode"; userCode: string; verificationUri: string; expiresInSeconds?: number }
	| { kind: "select"; message: string; options: { id: string; label: string }[] }
	| {
			kind: "prompt";
			message: string;
			placeholder?: string;
			allowEmpty?: boolean;
			secret?: boolean;
	  }
	| { kind: "progress"; message: string }
	| { kind: "success" }
	| { kind: "error"; message: string };

export interface LoginPush {
	loginId: string;
	providerId: string;
	frame: LoginFrame;
}

export interface LoginReply {
	loginId: string;
	value: string;
}

export interface ModelReference {
	provider: string;
	id: string;
}

export function modelReferenceKey(ref: Pick<ModelReference, "provider" | "id">): string {
	return JSON.stringify([ref.provider, ref.id]);
}

export function normalizeModelReferences(value: unknown): ModelReference[] {
	if (!Array.isArray(value)) return [];
	const result: ModelReference[] = [];
	const seen = new Set<string>();
	for (const candidate of value) {
		if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
		const provider = Reflect.get(candidate, "provider");
		const id = Reflect.get(candidate, "id");
		if (typeof provider !== "string" || typeof id !== "string") continue;
		if (!provider || !id || provider.includes("\0") || id.includes("\0")) continue;
		const ref = { provider, id };
		const key = modelReferenceKey(ref);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(ref);
	}
	return result;
}

export interface AppConfig {
	signet: SignetSettings;
	/** Models hidden from gooseberry catalog and selection surfaces. */
	hiddenModels?: ModelReference[];
}

export interface SignetSettings {
	enabled: boolean;
	address: string;
	port: number;
}

export interface SignetStatus {
	enabled: boolean;
	endpoint: string;
	reachable: boolean;
}

export type AppConfigPatch = Omit<Partial<AppConfig>, "signet"> & {
	signet?: Partial<SignetSettings>;
};

export const DEFAULT_SIGNET_SETTINGS: SignetSettings = {
	enabled: false,
	address: "127.0.0.1",
	port: 3850,
};

export const DEFAULT_CONFIG = {
	signet: DEFAULT_SIGNET_SETTINGS,
	hiddenModels: [],
} satisfies AppConfig;

export const IMAGE_MAX_BASE64_BYTES = 4.5 * 1024 * 1024;

export function base64EncodedLength(byteLength: number): number {
	return Math.ceil(byteLength / 3) * 4;
}

export const ACCEPTED_IMAGE_TYPES: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
];

export const REQUEST_IMAGE_BASE64_BUDGET = 24 * 1024 * 1024;

/**
 * Validate image blocks accepted by the browser session prompt and steer
 * protocol. The check is deliberately structural and does not decode image
 * bytes, which keeps it suitable for both browser and controller callers.
 */
export function validateRequestImages(value: unknown): asserts value is {
	type: "image";
	data: string;
	mimeType: string;
}[] {
	if (!Array.isArray(value)) throw new Error("Session images must be an array");
	let totalLength = 0;
	for (const image of value) {
		if (
			typeof image !== "object" ||
			image === null ||
			Array.isArray(image) ||
			Reflect.get(image, "type") !== "image" ||
			typeof Reflect.get(image, "data") !== "string" ||
			typeof Reflect.get(image, "mimeType") !== "string"
		) {
			throw new Error("Malformed session image");
		}
		const data = Reflect.get(image, "data") as string;
		const mimeType = Reflect.get(image, "mimeType") as string;
		if (!ACCEPTED_IMAGE_TYPES.includes(mimeType))
			throw new Error(`Unsupported image media type: ${mimeType}`);
		if (!isCanonicalBase64(data)) throw new Error("Session image data must be canonical base64");
		if (data.length > IMAGE_MAX_BASE64_BYTES)
			throw new Error("Session image exceeds the 4.5 MiB encoded size limit");
		totalLength += data.length;
		if (totalLength > REQUEST_IMAGE_BASE64_BUDGET)
			throw new Error("Session images exceed the 24 MiB aggregate encoded size limit");
	}
}

function isCanonicalBase64(value: string): boolean {
	if (!value || value.length % 4 !== 0) return false;
	if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	if (value.endsWith("==")) return (alphabet.indexOf(value.at(-3) ?? "") & 15) === 0;
	if (value.endsWith("=")) return (alphabet.indexOf(value.at(-2) ?? "") & 3) === 0;
	return true;
}

export function isRetriedAttempt(
	messages: readonly { role: string; stopReason?: string }[],
	index: number,
): boolean {
	const message = messages[index];
	if (message?.role !== "assistant" || message.stopReason !== "error") return false;
	return messages[index + 1]?.role === "assistant";
}

export type HistoryScope =
	| { kind: "chat"; sessionId: string }
	| { kind: "project"; projectId: string }
	| { kind: "all" };

export interface PromptHit {
	text: string;
	timestamp: number;
	sessionId: string;
	sessionTitle?: string;
	projectId?: string;
	cwd: string;
	messageIndex?: number;
	anchorText?: string;
}

export interface MessageHit extends PromptHit {
	role: "user" | "assistant";
	snippet: string;
	messageIndex: number;
	anchorText: string;
}

export const MAX_HISTORY_LIMIT = 200;

export const MAX_HISTORY_QUERY_LENGTH = 200;

export interface HistorySearchResult {
	prompts: PromptHit[];
	messages: MessageHit[];
	promptTotal: number;
	messageTotal: number;
	indexing: boolean;
	incomplete: boolean;
}
