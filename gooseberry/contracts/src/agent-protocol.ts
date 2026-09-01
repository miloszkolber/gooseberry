/** Browser-safe data projected by the Go controller. ACP stays controller-side. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | string;

export interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface TextContent {
	type: "text";
	text: string;
}
export interface ThinkingContent {
	type: "thinking";
	thinking: string;
}
export interface ToolCall {
	type: "toolCall";
	id: string;
	/** Exact upstream tool identity, when Goose provides one. */
	toolName?: string;
	/** Legacy display/renderer name. Prefer toolName when available. */
	name: string;
	arguments: unknown;
}

/** Trusted MCP Apps metadata projected from Goose for one completed tool call. */
export interface McpAppAttachment {
	toolName: string;
	extensionName: string;
	resourceUri: string;
}

export interface McpAppCsp {
	connectDomains?: string[];
	resourceDomains?: string[];
	frameDomains?: string[];
	baseUriDomains?: string[];
}

export interface McpAppPermissions {
	camera?: Record<string, never>;
	microphone?: Record<string, never>;
	geolocation?: Record<string, never>;
	clipboardWrite?: Record<string, never>;
}

export interface McpAppResourceContent {
	uri: string;
	mimeType?: string;
	text?: string;
	blob?: string;
	_meta?: Record<string, unknown>;
}

export interface McpAppResourceResult {
	contents: McpAppResourceContent[];
	_meta?: Record<string, unknown>;
}

export interface McpAppOpenResult {
	viewId: string;
	url: string;
	resource: {
		byteLength: number;
		csp?: McpAppCsp;
		permissions?: McpAppPermissions;
	};
}

export interface McpAppContentChunk {
	offset: number;
	data: string;
	nextOffset: number;
}

export interface McpAppToolResult {
	content: unknown[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
	_meta?: Record<string, unknown>;
}

/** Best-effort child tool requests reported by Goose for an outer Summon call. */
export interface SubagentActivityEvent {
	childSessionId: string;
	toolName: string;
}

export interface SubagentActivity {
	events: readonly SubagentActivityEvent[];
	truncated?: boolean;
}
export type StopReason = string;

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp?: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ImageContent | ThinkingContent | ToolCall)[];
	thinking?: string;
	stopReason?: string;
	errorMessage?: string;
	timestamp?: number;
}

export interface ToolResultMessage {
	role: "toolResult";
	toolCallId: string;
	isError?: boolean;
	content?: unknown;
	details?: unknown;
	app?: McpAppAttachment;
	subagentActivity?: SubagentActivity;
}

export interface PendingToolPreview {
	toolCallId: string;
	output?: unknown;
	app?: McpAppAttachment;
	subagentActivity?: SubagentActivity;
}
export interface PermissionRequest {
	id: string;
	sessionId: string;
	toolCallId: string;
	title: string;
	options: readonly { optionId: string; name: string; kind: string }[];
}

export type TranscriptMessage = UserMessage | AssistantMessage | ToolResultMessage;

export interface WireModelCostRates {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}
export interface WireModelCost extends WireModelCostRates {
	/** Currency symbol reported by Goose for these per-million-token rates. */
	currency: string;
	tiers?: (WireModelCostRates & { inputTokensAbove: number })[];
}
export type WireModelCostTier = WireModelCostRates & { inputTokensAbove: number };

export interface WireModel {
	id: string;
	name: string;
	provider: string;
	contextWindow?: number;
	maxTokens?: number;
	reasoning?: boolean;
	thinkingLevels?: ThinkingLevel[];
	input?: ("text" | "image")[];
	cost?: WireModelCost;
	available: boolean;
	hidden: boolean;
}

export interface RefreshedModels {
	models: WireModel[];
	complete: boolean;
}
export interface AgentSettlement {
	stopReason: string;
	errorMessage?: string;
}
export interface ContextUsage {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}
export interface SessionStats {
	sessionId: string;
	totalMessages: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
	cost: number;
	reported?: Partial<
		Record<"input" | "output" | "cacheRead" | "cacheWrite" | "total" | "cost", boolean>
	>;
	contextUsage?: ContextUsage;
}
export interface SessionSummary {
	sessionId: string;
	projectId: string;
	cwd: string;
	/** The recorded Goose session from which this chat was forked, when applicable. */
	parentSessionId?: string;
	title: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	messageCount: number;
	updatedAt: number;
	live: boolean;
	archived: boolean;
	lastSettlement?: AgentSettlement | null;
	queue?: SessionQueueState;
}

export const SESSION_TITLE_MAX_LENGTH = 200;

export function normalizeSessionTitle(value: unknown): string {
	if (typeof value !== "string") throw new Error("Session title must be text");
	const title = value.trim();
	if (!title) throw new Error("Session title cannot be empty");
	if (title.includes("\0")) throw new Error("Session title contains an invalid character");
	if (title.length > SESSION_TITLE_MAX_LENGTH) {
		throw new Error(`Session title must be ${SESSION_TITLE_MAX_LENGTH} characters or fewer`);
	}
	return title;
}

export interface SessionLifecycleChangedPayload {
	projectId: string;
	sessionId: string;
	operation: "created" | "renamed" | "archived" | "unarchived" | "forked";
	title?: string;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;
export type AgentEvent =
	| {
			type:
				| "run-start"
				| "text"
				| "image"
				| "thinking"
				| "tool-start"
				| "tool-update"
				| "tool-end"
				| "usage"
				| "context"
				| "config"
				| "complete"
				| "error"
				| "session-info";
			messageId?: string;
			text?: string;
			image?: ImageContent;
			toolCallId?: string;
			toolName?: string;
			status?: string;
			usage?: Partial<SessionStats["tokens"]> & { cost?: number };
			reported?: SessionStats["reported"];
			contextUsage?: ContextUsage;
			configOptions?: readonly { id: string; currentValue?: string | boolean }[];
			title?: string;
			error?: string;
			tool?: unknown;
			app?: McpAppAttachment;
			subagentActivity?: SubagentActivity;
	  }
	| { type: "agent_start" }
	| { type: "commands"; commands: SlashCommandInfo[] }
	| ({ type: "queue_update" } & SessionQueueState)
	| { type: "message_start"; message: AgentMessage }
	| {
			type: "message_update";
			assistantMessageEvent:
				| { type: "done"; message: AssistantMessage }
				| { type: "error"; error: AssistantMessage }
				| { type: string; partial: AssistantMessage };
	  }
	| { type: "message_end"; message: AgentMessage }
	| { type: "tool_execution_start"; toolCallId: string }
	| { type: "tool_execution_update"; toolCallId: string; partialResult: unknown }
	| { type: "tool_execution_end"; toolCallId: string; isError: boolean; result: unknown }
	| { type: "agent_end"; messages: AgentMessage[]; willRetry: boolean }
	| { type: "agent_settled"; terminal: AgentSettlement | null }
	| { type: "compaction_start"; reason: "manual" | "threshold" | "overflow" }
	| {
			type: "compaction_end";
			reason: "manual" | "threshold" | "overflow";
			result?: { tokensBefore: number; estimatedTokensAfter?: number };
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  }
	| { type: "auto_retry_start"; attempt: number; maxAttempts: number; delayMs: number }
	| { type: "auto_retry_end"; success: boolean; attempt: number; finalError?: string }
	| { type: "summarization_retry_scheduled"; attempt: number; maxAttempts: number; delayMs: number }
	| { type: "summarization_retry_finished" }
	| { type: "thinking_level_changed"; level: ThinkingLevel };
export interface SessionEventPayload {
	sessionId: string;
	event: AgentEvent;
}

export interface SlashCommandInfo {
	name: string;
	description?: string;
	inputHint?: string;
	source: "goose" | "extension" | "prompt" | "skill";
	sourceInfo: {
		path: string;
		source: string;
		scope: "user" | "project" | "temporary";
		origin: "package" | "top-level";
		baseDir?: string;
	};
}

/** Controller-owned queue state. Goose has no queue-manipulation API. */
export type QueueLane = "steering" | "followUp";
export interface SessionQueueState {
	/** Opaque controller revision required for conditional edit/removal. */
	revision?: string;
	steering: readonly string[];
	followUp: readonly string[];
}

export type ExtUiRequest =
	| { id: string; sessionId: string; kind: "select"; title: string; options: string[] }
	| { id: string; sessionId: string; kind: "confirm"; title: string; message: string }
	| {
			id: string;
			sessionId: string;
			kind: "input" | "editor";
			title: string;
			placeholder?: string;
			prefill?: string;
	  }
	| {
			id: string;
			sessionId: string;
			kind: "notify";
			message: string;
			level: "info" | "warning" | "error";
	  }
	| { id: string; sessionId: string; kind: "setStatus"; key: string; text: string | null }
	| { id: string; sessionId: string; kind: "setWidget"; key: string; content: string[] | null }
	| { id: string; sessionId: string; kind: "setTitle"; title: string }
	| { id: string; sessionId: string; kind: "dismiss" };
export interface AskUserQuestionResult {
	answers: AskUserQuestionAnswer[];
	cancelled: boolean;
}
export interface AskUserQuestionOption {
	label: string;
	description: string;
	preview?: string;
	recommendedReason?: string;
}
export interface AskUserQuestionItem {
	question: string;
	header: string;
	options: AskUserQuestionOption[];
	multiSelect?: boolean;
}
export interface AskUserQuestionArgs {
	questions: AskUserQuestionItem[];
}
export interface PendingUserQuestion extends AskUserQuestionArgs {
	id: string;
	sessionId: string;
}
export interface AskUserQuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
	notes?: string;
	preview?: string;
}
export function isTranscriptMessageRole(role: string): role is TranscriptMessage["role"] {
	return role === "user" || role === "assistant" || role === "toolResult";
}
