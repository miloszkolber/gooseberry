export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

export interface GooseImage {
	data: string;
	mimeType: string;
}

export type GoosePromptContent = { type: "text"; text: string } | ({ type: "image" } & GooseImage);

export interface GooseUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	cost?: number;
	costSource?: "provider_reported" | "estimated" | string;
	elapsedMs?: number;
	timeToFirstTokenMs?: number;
	isCompaction?: boolean;
}

export interface GooseContextUsage {
	used: number;
	contextLimit: number;
	accumulatedInputTokens: number;
	accumulatedOutputTokens: number;
	accumulatedCost?: number;
}

export interface GooseTool {
	name: string;
	description: string;
	parameters: string[];
	permission?: GooseToolPermission;
	inputSchema: JsonValue;
	outputSchema?: JsonValue;
}

/** Goose v1.48 global permission.yaml values. */
export type GooseToolPermission = "always_allow" | "ask_before" | "never_allow";

/**
 * Normalized extension metadata. The raw Goose object is deliberately retained
 * only in this server-side ACP adapter so callers can pass the exact object
 * back to Goose without re-serializing sensitive MCP configuration.
 */
export interface GooseExtension {
	name: string;
	type: "builtin" | "platform" | "mcp";
	displayName?: string;
	description?: string;
	bundled?: boolean;
	availableTools?: string[];
	raw: JsonValue;
}

export interface GooseConfiguredExtension extends GooseExtension {
	enabled: boolean;
	configKey?: string;
}

export interface GoosePermissionRequest {
	sessionId: string;
	toolCall: { toolCallId: string; title?: string; kind?: string; raw: JsonValue };
	options: readonly GoosePermissionOption[];
}

/** The original ACP option is retained so callers can render its full payload. */
export interface GoosePermissionOption {
	optionId: string;
	name: string;
	kind: string;
	raw: JsonValue;
}

/** Select the exact ACP option instead of collapsing options that share a kind. */
export type GoosePermissionDecision = { optionId: string } | "cancelled";
export type GoosePermissionHandler = (
	request: GoosePermissionRequest,
	signal: AbortSignal,
) => Promise<GoosePermissionDecision> | GoosePermissionDecision;

export interface GooseSession {
	sessionId: string;
	cwd?: string;
	title?: string;
	updatedAt?: string;
	createdAt?: string;
	projectId?: string;
	messageCount?: number;
	archivedAt?: string;
	archived?: boolean;
	raw: JsonValue;
}

export interface GooseModel {
	id: string;
	name: string;
	providerId?: string;
	family?: string;
	contextLimit?: number;
	maxOutputTokens?: number;
	reasoning?: boolean;
	recommended?: boolean;
	modalities?: readonly string[];
	raw: JsonValue;
}

/** Exact safe fields returned by Goose's canonical bundled model registry. */
export interface GooseCanonicalModelInfo {
	provider: string;
	model: string;
	contextLimit: number;
	maxOutputTokens?: number;
	reasoning: boolean;
	inputTokenCost?: number;
	outputTokenCost?: number;
	cacheReadTokenCost?: number;
	cacheWriteTokenCost?: number;
	currency: string;
}

export interface GooseProviderReadiness {
	providerId: string;
	ready: boolean;
	/** Whether Goose reported a non-null readiness issue. Its text is never retained. */
	hasIssue: boolean;
}

export type GooseAgentMentionSourceType =
	| "skill"
	| "builtinSkill"
	| "recipe"
	| "subrecipe"
	| "agent"
	| "project";

/** Raw and source path remain available only to the controller. */
export interface GooseAgentMention {
	name: string;
	description: string;
	sourceType: GooseAgentMentionSourceType;
	mention: string;
	sourcePath?: string;
	raw: JsonValue;
}

export interface GooseProvider {
	id: string;
	name: string;
	description?: string;
	configured?: boolean;
	available?: boolean;
	defaultModel?: string;
	supportsRefresh?: boolean;
	refreshing?: boolean;
	visibleInSetup?: boolean;
	deprecated?: boolean;
	acp: boolean;
	lastRefreshError?: string;
	configKeys: readonly GooseProviderConfigKey[];
	setupSteps: readonly string[];
	models: readonly GooseModel[];
	raw: JsonValue;
}

export interface GooseProviderConfigKey {
	name: string;
	required: boolean;
	secret: boolean;
	defaultValue?: string;
	oauthFlow: boolean;
	deviceCodeFlow: boolean;
	primary: boolean;
}

export interface GooseProviderConfigField {
	key: string;
	value?: string;
	isSet: boolean;
	isSecret: boolean;
	required: boolean;
}

export interface GooseConfigOption {
	id: string;
	name?: string;
	description?: string;
	currentValue?: string | boolean;
	values: readonly { value: string; name?: string }[];
	raw: JsonValue;
}

export interface GooseSessionInfo {
	session: GooseSession;
	providerId?: string;
	modelId?: string;
	thinkingEffort?: string;
	configOptions: readonly GooseConfigOption[];
	raw: JsonValue;
}

export type GooseMcpServer =
	| {
			type: "http" | "sse";
			name: string;
			url: string;
			headers: readonly { name: string; value: string }[];
	  }
	| { type: "acp"; name: string; serverId: string }
	| {
			name: string;
			command: string;
			args: readonly string[];
			env: readonly { name: string; value: string }[];
	  };

export interface GooseRecipe {
	version?: string;
	title: string;
	description: string;
	instructions?: string;
	prompt?: string;
	[key: string]: JsonValue | undefined;
}

/** A saved recipe and the identity/metadata Goose uses for later mutations. */
export interface GooseRecipeListEntry {
	id: string;
	recipe: GooseRecipe;
	filePath: string;
	lastModified: string;
	scheduleCron?: string;
	slashCommand?: string;
	raw: JsonValue;
}

export interface GooseSchedule {
	id: string;
	source: string;
	cron: string;
	lastRun?: string;
	currentlyRunning: boolean;
	paused: boolean;
	currentSessionId?: string;
	jobStartTime?: string;
	raw: JsonValue;
}

export interface GooseScheduledJobInspection {
	running: boolean;
	sessionId?: string;
	jobStartTime?: string;
	runningDurationSeconds?: number;
}

export interface GooseSlashCommand {
	name: string;
	description?: string;
	inputHint?: string;
	raw: JsonValue;
}

export type GooseUpdate =
	| {
			type: "text";
			sessionId: string;
			role: "user" | "assistant";
			messageId?: string;
			text: string;
			raw: JsonValue;
	  }
	| {
			type: "image";
			sessionId: string;
			role: "user" | "assistant";
			messageId?: string;
			image: GooseImage;
			raw: JsonValue;
	  }
	| { type: "thinking"; sessionId: string; messageId?: string; text: string; raw: JsonValue }
	| {
			type: "tool-call";
			sessionId: string;
			toolCallId: string;
			/** Goose v1.48 exact identity from _meta.goose.toolCall.toolName. */
			toolName?: string;
			title?: string;
			kind?: string;
			content?: readonly JsonValue[];
			locations?: readonly JsonValue[];
			rawInput?: JsonValue;
			raw: JsonValue;
	  }
	| {
			type: "tool-update";
			sessionId: string;
			toolCallId: string;
			status?: string;
			content?: readonly JsonValue[];
			error?: JsonValue;
			rawOutput?: JsonValue;
			raw: JsonValue;
	  }
	| { type: "usage"; sessionId: string; messageId?: string; usage: GooseUsage; raw: JsonValue }
	| { type: "context-usage"; sessionId: string; usage: GooseContextUsage; raw: JsonValue }
	| { type: "status"; sessionId: string; status: string; message: string; raw: JsonValue }
	| {
			type: "config";
			sessionId: string;
			configOptions: readonly GooseConfigOption[];
			raw: JsonValue;
	  }
	| {
			type: "session-info";
			sessionId: string;
			session: GooseSession;
			/** Present even when null, which explicitly clears Goose's active run. */
			activeRunId?: string | null;
			raw: JsonValue;
	  }
	| { type: "unknown"; sessionId: string; updateType: string; raw: JsonValue };

export type GooseClientEvent =
	| { type: "ready"; generation: number }
	| { type: "disconnected"; error?: Error }
	| { type: "update"; update: GooseUpdate }
	| {
			type: "provider-device-code";
			providerId: string;
			userCode: string;
			verificationUri: string;
			expiresIn: number;
	  }
	| { type: "protocol-error"; error: Error };

export interface GooseConnection {
	readonly closed: Promise<void>;
	request(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
	notify(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<void>;
	close(): void;
}

export interface GooseConnectionFactory {
	connect(handlers: {
		onSessionUpdate(params: unknown): void;
		onGooseNotification(method: string, params: unknown): void;
		onPermission(params: unknown, signal: AbortSignal): Promise<unknown>;
	}): Promise<GooseConnection>;
}
