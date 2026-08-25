export type TabStatus = "idle" | "running" | "waiting" | "error";

export interface Project {
	id: string;
	name: string;
	path: string;
	slug: string;
	lastOpened: number;
	closed?: true;
	trusted?: boolean;
	disabledSkills?: string[];
	disabledGroups?: string[];
}

export interface DiffStats {
	added: number;
	removed: number;
}

export interface Workspace {
	id: string;
	projectId: string;
	kind?: "default" | "external";
	name: string;
	branch: string;
	worktreePath: string;
	baseBranch: string;
	diffBase?: string;
	renamed?: boolean;
	diffStats?: DiffStats;
	skillOverrides?: Record<string, "on" | "off">;
}

export type ExistingWorktreeCandidate =
	| { path: string; branch: string; status: "available" }
	| { path: string; status: "detached" };

export interface EditorInfo {
	id: string;
	label: string;
	kind: "gui" | "terminal";
}

export type WorkspaceSkillChange = "none" | "detected" | "unknown";

export interface WorkspaceFsChangedPayload {
	workspaceId: string;
	paths: string[];
	truncated: boolean;
	skillChange: WorkspaceSkillChange;
}

export interface Session {
	id: string;
	workspaceId: string;
	sessionId: string;
	title: string;
	status: TabStatus;
}

export interface SessionGoal {
	workspaceId: string;
	sessionId: string;
	goal: string | null;
	active: boolean;
	updatedAt: number | null;
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

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitFileChange {
	path: string;
	status: GitFileStatus;
	added?: number;
	removed?: number;
}

export interface GitStatus {
	branch: string;
	changes: GitFileChange[];
}

export type GitDiffScope =
	| { kind: "branch" }
	| { kind: "uncommitted" }
	| { kind: "commit"; sha: string }
	| { kind: "pinned"; baseRef: string };

export interface GitCommit {
	sha: string;
	shortSha: string;
	subject: string;
	author: string;
	committedAt: string;
}

export interface BranchList {
	local: string[];
	remote: string[];
	defaultBranch: string;
}

export type ProviderAuthKind = "oauth" | "api-key" | "env" | "other";

export interface ProviderStatus {
	id: string;
	name: string;
	configured: boolean;
	kind?: ProviderAuthKind;
	detail?: string;
	canOAuth?: boolean;
	canApiKey?: boolean;
	canLogout?: boolean;
}

export interface ProviderStatusReport {
	providers: ProviderStatus[];
}

export type PiProfileCapabilityId =
	| "browser"
	| "webAccess"
	| "signetMemory"
	| "goals"
	| "subagents"
	| "protectedStateGuard";

/** Persisted Mewa choices for the curated Pi profile.
 *
 * The protected-state guard is intentionally absent. It is a mandatory
 * safety boundary and cannot be disabled through Mewa settings.
 */
export interface PiProfileSettings {
	browser: boolean;
	webAccess: boolean;
	signetMemory: boolean;
	goals: boolean;
	subagents: boolean;
}

export type PiProfileSettingsPatch = Partial<PiProfileSettings>;

export interface PiProfileCapability {
	id: PiProfileCapabilityId;
	label: string;
	description: string;
	enabled: boolean;
	available: boolean;
	required?: boolean;
	unavailableReason?: string;
}

export interface PiProfileDescriptor {
	id: "mewa";
	label: "Mewa";
	capabilities: PiProfileCapability[];
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

export type ThemeId = string;

export interface AppConfig {
	theme: ThemeId;
	terminalReplayKb: number;
	piProfile?: PiProfileSettings;
}

export type AppConfigPatch = Omit<Partial<AppConfig>, "piProfile"> & {
	piProfile?: PiProfileSettingsPatch;
};

export const TERMINAL_REPLAY_KB = { min: 0, max: 1024, default: 64 } as const;

export const DEFAULT_PI_PROFILE_SETTINGS: Required<PiProfileSettings> = {
	browser: true,
	webAccess: true,
	signetMemory: true,
	goals: true,
	subagents: true,
};

export const DEFAULT_CONFIG = {
	theme: "dark",
	terminalReplayKb: TERMINAL_REPLAY_KB.default,
	piProfile: DEFAULT_PI_PROFILE_SETTINGS,
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
	| { kind: "workspace"; workspaceId: string }
	| { kind: "project"; projectId: string }
	| { kind: "all" };

export interface PromptHit {
	text: string;
	timestamp: number;
	sessionId: string;
	sessionTitle?: string;
	workspaceId?: string;
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
}
