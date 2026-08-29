import { randomUUID } from "node:crypto";
import {
	type AgentEvent,
	type AgentSettlement,
	type AskUserQuestionArgs,
	type AskUserQuestionResult,
	type AssistantMessage,
	type HistoryScope,
	type HistorySearchResult,
	type ImageContent,
	type LoginFrame,
	type LoginPush,
	MAX_HISTORY_LIMIT,
	MAX_HISTORY_QUERY_LENGTH,
	modelReferenceKey,
	normalizeSessionTitle,
	type PermissionRequest,
	type QueueLane,
	type SessionEventPayload,
	type SessionLifecycleChangedPayload,
	type SessionStats,
	type SessionSummary,
	type SlashCommandInfo,
	type ThinkingLevel,
	type TranscriptMessage,
	type UserMessage,
	type WireModel,
} from "@gooseberry/contracts";
import {
	GooseClient,
	type GooseClientEvent,
	type GooseConfigOption,
	type GooseMcpServer,
	type GoosePermissionDecision,
	type GoosePermissionRequest,
	type GooseProviderConfigKey,
	type GooseSchedule,
	type GooseSessionInfo,
	type GooseUpdate,
	isGooseResourceNotFound,
} from "@gooseberry/goose-client";
import { assertMountedDirectory } from "../path-admission";
import {
	forgetProjectSession,
	loadProjectSessionRecords,
	recordProjectSession,
} from "../persistence";
import { getConfig, updateConfig } from "../settings";

interface Entry {
	projectId: string;
	cwd: string;
	title: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	configOptions: readonly GooseConfigOption[];
	messages: TranscriptMessage[];
	isStreaming: boolean;
	lastSettlement?: AgentSettlement | null | undefined;
	stats: SessionStats;
	queue: { steering: string[]; followUp: string[] };
	promptGeneration: number;
	consumedQuestionToolCalls: Set<string>;
	runId?: string | undefined;
	objectiveToken: string;
	/** The Goose ACP connection generation that loaded or created this session. */
	attachedGeneration?: number | undefined;
	attachment?: { generation: number; promise: Promise<void> } | undefined;
	/** Fresh state receiving a session/load replay until it can be atomically committed. */
	replay?: Entry | undefined;
	pendingUserEcho?:
		| {
				text: string;
				offset: number;
				images: readonly ImageContent[];
				matchedImages: boolean[];
		  }
		| undefined;
}

const sessions = new Map<string, Entry>();
const followUpDrainTimers = new Map<string, ReturnType<typeof setTimeout>>();
const sessionOperationCounts = new Map<string, number>();
const archivingSessions = new Set<string>();
let publisher: (payload: SessionEventPayload) => void = () => {};
let deletedPublisher: (payload: { projectId: string; sessionId: string }) => void = () => {};
let lifecyclePublisher: (payload: SessionLifecycleChangedPayload) => void = () => {};
let configuredClient: GooseClient | undefined;
let subscribedClient: GooseClient | undefined;
let objectiveMcpUrl: string | undefined;
let gooseStatus: { configured: boolean; reachable: boolean; error?: string; version?: string } = {
	configured: Boolean(process.env.GOOSEBERRY_GOOSE_SECRET_KEY?.trim()),
	reachable: false,
};
interface PendingPermission {
	sessionId: string;
	request: GoosePermissionRequest;
	resolve: (decision: GoosePermissionDecision) => void;
	timer: ReturnType<typeof setTimeout>;
	aborted: () => void;
}
const pendingPermissions = new Map<string, PendingPermission>();
interface PendingQuestion {
	sessionId: string;
	args: AskUserQuestionArgs;
	resolve: (result: AskUserQuestionResult) => void;
	timer: ReturnType<typeof setTimeout>;
}
const pendingQuestions = new Map<string, PendingQuestion>();
const QUESTION_TIMEOUT_MS = 30 * 60_000;
const MAX_PENDING_PERMISSION_SNAPSHOT = 100;
let permissionPublisher: (request: {
	id: string;
	sessionId: string;
	toolCallId: string;
	title: string;
	options: readonly { optionId: string; name: string; kind: string }[];
}) => void = () => {};
let permissionResolvedPublisher: (payload: { sessionId: string; permissionId: string }) => void =
	() => {};
let providerLoginPublisher: (clientKey: string, payload: LoginPush) => void = () => {};
const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60_000;
let permissionTimeoutOverride: number | undefined;
export function setPermissionTimeoutForTests(timeoutMs: number | undefined): void {
	permissionTimeoutOverride = timeoutMs;
}
function permissionTimeoutMs(): number {
	return permissionTimeoutOverride ?? DEFAULT_PERMISSION_TIMEOUT_MS;
}

export function setSessionPublisher(fn: (payload: SessionEventPayload) => void): void {
	publisher = fn;
}
export function setSessionDeletedPublisher(
	fn: (payload: { projectId: string; sessionId: string }) => void,
): void {
	deletedPublisher = fn;
}
export function setSessionLifecyclePublisher(fn: typeof lifecyclePublisher): void {
	lifecyclePublisher = fn;
}
export function setPermissionPublisher(fn: typeof permissionPublisher): void {
	permissionPublisher = fn;
}
export function setPermissionResolvedPublisher(fn: typeof permissionResolvedPublisher): void {
	permissionResolvedPublisher = fn;
}
export function setProviderLoginPublisher(fn: typeof providerLoginPublisher): void {
	providerLoginPublisher = fn;
}

interface PendingProviderLogin {
	loginId: string;
	providerId: string;
	clientKey: string;
	type: "oauth" | "api_key";
	fields: GooseProviderConfigKey[];
	fieldIndex: number;
	values: { key: string; value: string }[];
	abortController: AbortController;
	requestInFlight: boolean;
	expiresTimer?: ReturnType<typeof setTimeout>;
}

const pendingProviderLogins = new Map<string, PendingProviderLogin>();
const providerLoginSnapshots = new Map<
	string,
	{ push: LoginPush; expiresTimer: ReturnType<typeof setTimeout> }
>();
const providerLoginClientReservations = new Set<string>();
const providerLoginProviderReservations = new Set<string>();
interface HistoryIndexEntry {
	projectId: string;
	sessionId: string;
	cwd: string;
	title: string;
	timestamp: number;
	messages: { role: "user" | "assistant"; text: string; messageIndex: number }[];
}
const historySearchIndex = new Map<string, HistoryIndexEntry>();
const historyIndexOwnedSessions = new Set<string>();
const historySuppressedSessions = new Set<string>();
const historyIndexFailures = new Map<string, { attempts: number; retryAt: number }>();
const historyIndexing = new Map<string, Promise<void>>();
const HISTORY_INDEX_BATCH_SIZE = 8;
const HISTORY_INDEX_MAX_SESSIONS = 200;
const HISTORY_INDEX_MAX_MESSAGES = 500;
const HISTORY_INDEX_MAX_TEXT_CHARS = 256 * 1024;
const HISTORY_INDEX_MAX_MESSAGE_CHARS = 16 * 1024;
const HISTORY_INDEX_MAX_ATTEMPTS = 3;
const SESSION_INFO_BATCH_SIZE = 8;
const SESSION_INFO_MAX_FALLBACKS = 200;
const PROVIDER_LOGIN_TIMEOUT_MS = 10 * 60_000;
const PROVIDER_LOGIN_REPLAY_MS = 60_000;
let providerLoginTimeoutOverride: number | undefined;

export function setProviderLoginTimeoutForTests(timeoutMs: number | undefined): void {
	providerLoginTimeoutOverride = timeoutMs;
}

function providerLoginTimeoutMs(): number {
	return providerLoginTimeoutOverride ?? PROVIDER_LOGIN_TIMEOUT_MS;
}

function cacheProviderLoginSnapshot(clientKey: string, push: LoginPush): void {
	const current = providerLoginSnapshots.get(clientKey);
	if (current) clearTimeout(current.expiresTimer);
	const expiresTimer = setTimeout(() => {
		if (providerLoginSnapshots.get(clientKey)?.push === push) {
			providerLoginSnapshots.delete(clientKey);
		}
	}, PROVIDER_LOGIN_REPLAY_MS);
	expiresTimer.unref?.();
	providerLoginSnapshots.set(clientKey, { push, expiresTimer });
}

/** The latest bounded public provider-login frame for a short browser reconnect. */
export function providerLoginSnapshot(clientKey: string): LoginPush | undefined {
	return providerLoginSnapshots.get(clientKey)?.push;
}

function cacheProviderLoginFrame(login: PendingProviderLogin, frame: LoginFrame): LoginPush {
	const push: LoginPush = {
		loginId: login.loginId,
		providerId: login.providerId,
		frame,
	};
	cacheProviderLoginSnapshot(login.clientKey, push);
	return push;
}

function publishProviderLogin(login: PendingProviderLogin, frame: LoginFrame): void {
	const push = cacheProviderLoginFrame(login, frame);
	providerLoginPublisher(login.clientKey, push);
}

function clearPendingProviderLogin(login: PendingProviderLogin): void {
	if (login.expiresTimer) clearTimeout(login.expiresTimer);
	if (pendingProviderLogins.get(login.loginId) === login) {
		pendingProviderLogins.delete(login.loginId);
	}
}

function armProviderLoginExpiry(login: PendingProviderLogin): void {
	login.expiresTimer = setTimeout(() => {
		if (pendingProviderLogins.get(login.loginId) !== login) return;
		const wasCancelled = login.abortController.signal.aborted;
		login.abortController.abort(new Error("Provider connection timed out"));
		if (!wasCancelled) {
			publishProviderLogin(login, { kind: "error", message: "Provider connection timed out." });
		}
		if (login.requestInFlight) client().resetConnection();
		else clearPendingProviderLogin(login);
	}, providerLoginTimeoutMs());
	login.expiresTimer.unref?.();
}

function providerFieldFrame(field: GooseProviderConfigKey): LoginFrame {
	return {
		kind: "prompt",
		message: `Enter ${field.name}`,
		...(field.defaultValue ? { placeholder: field.defaultValue, allowEmpty: true } : {}),
		secret: field.secret,
	};
}
function permissionPayload(id: string, request: GoosePermissionRequest): PermissionRequest {
	return {
		id,
		sessionId: request.sessionId,
		toolCallId: request.toolCall.toolCallId,
		title: request.toolCall.title ?? request.toolCall.kind ?? "Tool permission",
		options: request.options.map(({ optionId, name, kind }) => ({ optionId, name, kind })),
	};
}
/** A bounded, public-only projection for authenticated browser reconnects. */
export function pendingPermissionSnapshot(): PermissionRequest[] {
	return [...pendingPermissions]
		.slice(0, MAX_PENDING_PERMISSION_SNAPSHOT)
		.map(([id, pending]) => permissionPayload(id, pending.request));
}
/** The controller publishes this loopback HTTP MCP endpoint to new and loaded Goose sessions. */
export function setObjectiveMcpUrl(url: string | undefined): void {
	objectiveMcpUrl = url;
}
function objectiveMcp(token: string): readonly GooseMcpServer[] {
	return objectiveMcpUrl
		? [
				{
					type: "http",
					name: "gooseberry-objectives",
					url: objectiveMcpUrl,
					headers: [{ name: "Authorization", value: `Bearer ${token}` }],
				},
			]
		: [];
}

/** Test and embedding seam. The production client is created from GOOSEBERRY_GOOSE_* once. */
export function setGooseClient(client: GooseClient | undefined): void {
	configuredClient?.shutdown();
	for (const timer of followUpDrainTimers.values()) clearTimeout(timer);
	followUpDrainTimers.clear();
	configuredClient = client;
	subscribedClient = undefined;
	for (const entry of sessions.values()) {
		entry.attachedGeneration = undefined;
		entry.attachment = undefined;
	}
}

function gooseUrl(): string {
	return "ws://127.0.0.1:3284/acp";
}

function client(): GooseClient {
	const secretKey = process.env.GOOSEBERRY_GOOSE_SECRET_KEY?.trim();
	if (!configuredClient && !secretKey) {
		throw new Error(
			"Goose is not configured: set GOOSEBERRY_GOOSE_SECRET_KEY and start Goose ACP.",
		);
	}
	configuredClient ??= new GooseClient({
		url: gooseUrl(),
		...(secretKey ? { secretKey } : {}),
		permissionHandler: requestPermission,
	});
	if (subscribedClient !== configuredClient) {
		subscribedClient = configuredClient;
		configuredClient.on(onGooseEvent);
	}
	return configuredClient;
}
export function currentGooseStatus(): typeof gooseStatus {
	return gooseStatus;
}
export async function refreshGooseStatus(): Promise<typeof gooseStatus> {
	if (!process.env.GOOSEBERRY_GOOSE_SECRET_KEY?.trim() && !configuredClient) {
		gooseStatus = {
			configured: false,
			reachable: false,
			error: "GOOSEBERRY_GOOSE_SECRET_KEY is not configured",
		};
		return gooseStatus;
	}
	try {
		await client().ready({ timeoutMs: 2_000 });
		gooseStatus = { configured: true, reachable: true };
		return gooseStatus;
	} catch (error) {
		gooseStatus = {
			configured: true,
			reachable: false,
			error: error instanceof Error ? error.message : String(error),
		};
		return gooseStatus;
	}
}

function emit(sessionId: string, event: AgentEvent): void {
	publisher({ sessionId, event });
}
function emptyStats(sessionId: string): SessionStats {
	return {
		sessionId,
		totalMessages: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		cost: 0,
		reported: {},
	};
}
function modelFrom(info: GooseSessionInfo): WireModel | null {
	if (!info.providerId || !info.modelId) return null;
	return {
		id: info.modelId,
		name: info.modelId,
		provider: info.providerId,
		available: true,
		hidden: false,
	};
}
function thinkingFrom(options: readonly GooseConfigOption[]): ThinkingLevel {
	const value = options.find((option) => option.id === "thinking_effort")?.currentValue;
	return typeof value === "string" ? value : "off";
}

export function requestPermission(
	request: GoosePermissionRequest,
	signal: AbortSignal,
): Promise<GoosePermissionDecision> {
	if (signal.aborted) return Promise.resolve("cancelled");
	const id = randomUUID();
	return new Promise((resolve) => {
		const finish = (decision: GoosePermissionDecision) => {
			const pending = pendingPermissions.get(id);
			if (!pending) return;
			pendingPermissions.delete(id);
			clearTimeout(pending.timer);
			signal.removeEventListener("abort", pending.aborted);
			permissionResolvedPublisher({ sessionId: pending.sessionId, permissionId: id });
			resolve(decision);
		};
		const aborted = () => finish("cancelled");
		const timer = setTimeout(() => finish("cancelled"), permissionTimeoutMs());
		pendingPermissions.set(id, {
			sessionId: request.sessionId,
			request,
			resolve: finish,
			timer,
			aborted,
		});
		signal.addEventListener("abort", aborted, { once: true });
		permissionPublisher(permissionPayload(id, request));
	});
}

export function resolvePermission(
	sessionId: string,
	permissionId: string,
	optionId?: string,
): void {
	const pending = pendingPermissions.get(permissionId);
	if (!pending || pending.sessionId !== sessionId)
		throw new Error("Unknown or expired permission request");
	const option =
		optionId === undefined
			? undefined
			: pending.request.options.find((candidate) => candidate.optionId === optionId);
	if (optionId === undefined) pending.resolve("cancelled");
	else if (!option) throw new Error("Invalid permission option");
	else pending.resolve({ optionId: option.optionId });
}

function cancelPermissions(sessionId: string): void {
	for (const pending of pendingPermissions.values())
		if (pending.sessionId === sessionId) pending.resolve("cancelled");
}
function entryFrom(info: GooseSessionInfo, projectId: string, cwd: string): Entry {
	const sessionId = info.session.sessionId;
	return {
		projectId,
		cwd,
		title: info.session.title ?? "Chat",
		model: modelFrom(info),
		thinkingLevel: thinkingFrom(info.configOptions),
		configOptions: info.configOptions,
		messages: [],
		isStreaming: false,
		stats: emptyStats(sessionId),
		queue: { steering: [], followUp: [] },
		promptGeneration: 0,
		consumedQuestionToolCalls: new Set(),
		objectiveToken: randomUUID(),
	};
}

type UserContentBlock = Exclude<UserMessage["content"], string>[number];
type AssistantContentBlock = AssistantMessage["content"][number];

function appendUserBlock(entry: Entry, block: UserContentBlock): void {
	const previous = entry.messages.at(-1);
	if (previous?.role !== "user") {
		entry.messages.push({ role: "user", content: [block] });
		return;
	}
	if (typeof previous.content === "string") {
		if (block.type === "text") {
			previous.content = `${previous.content}${block.text}`;
			return;
		}
		previous.content = [{ type: "text", text: previous.content }, block];
		return;
	}
	const last = previous.content.at(-1);
	if (block.type === "text" && last?.type === "text") {
		last.text = `${last.text}${block.text}`;
		return;
	}
	previous.content.push(block);
}

function appendAssistantBlock(entry: Entry, block: AssistantContentBlock): void {
	const previous = entry.messages.at(-1);
	if (previous?.role !== "assistant") {
		entry.messages.push({ role: "assistant", content: [block] });
		return;
	}
	const last = previous.content.at(-1);
	if (block.type === "text" && last?.type === "text") {
		last.text = `${last.text}${block.text}`;
		return;
	}
	if (block.type === "thinking" && last?.type === "thinking") {
		last.thinking = `${last.thinking}${block.thinking}`;
		return;
	}
	previous.content.push(block);
}

function onGooseEvent(event: GooseClientEvent): void {
	if (event.type === "disconnected") {
		for (const pending of pendingPermissions.values()) pending.resolve("cancelled");
		for (const [toolCallId, pending] of pendingQuestions) {
			clearTimeout(pending.timer);
			pendingQuestions.delete(toolCallId);
			pending.resolve({ answers: [], cancelled: true });
		}
		for (const [sessionId, entry] of sessions) {
			entry.attachedGeneration = undefined;
			if (entry.replay) continue;
			if (!entry.isStreaming) continue;
			entry.isStreaming = false;
			entry.lastSettlement = {
				stopReason: "connection_lost",
				errorMessage: "Goose ACP connection closed",
			};
			emit(sessionId, { type: "error", error: "Goose ACP connection closed" });
		}
		return;
	}
	if (event.type === "provider-device-code") {
		for (const login of pendingProviderLogins.values()) {
			if (
				login.type !== "oauth" ||
				login.providerId !== event.providerId ||
				login.abortController.signal.aborted
			) {
				continue;
			}
			publishProviderLogin(login, {
				kind: "deviceCode",
				userCode: event.userCode,
				verificationUri: event.verificationUri,
				...(event.expiresIn > 0 ? { expiresInSeconds: event.expiresIn } : {}),
			});
		}
		return;
	}
	if (event.type !== "update") return;
	const update = event.update;
	const entry = sessions.get(update.sessionId);
	if (!entry) return;
	applyGooseUpdate(entry.replay ?? entry, update, entry.replay === undefined);
}

function applyGooseUpdate(entry: Entry, update: GooseUpdate, publish: boolean): void {
	const publishEvent = (event: AgentEvent) => {
		if (publish) emit(update.sessionId, event);
	};
	switch (update.type) {
		case "text": {
			entry.isStreaming = true;
			if (update.role === "user") {
				const echo = entry.pendingUserEcho;
				if (
					echo &&
					echo.text.slice(echo.offset, echo.offset + update.text.length) === update.text
				) {
					echo.offset += update.text.length;
					if (userEchoComplete(echo)) delete entry.pendingUserEcho;
					break;
				}
				delete entry.pendingUserEcho;
				appendUserBlock(entry, { type: "text", text: update.text });
				entry.stats.totalMessages = entry.messages.length;
				publishEvent({
					type: "message_start",
					message: entry.messages.at(-1) as TranscriptMessage,
				});
				break;
			}
			appendAssistantBlock(entry, { type: "text", text: update.text });
			entry.stats.totalMessages = entry.messages.length;
			publishEvent({
				type: "text",
				...(update.messageId ? { messageId: update.messageId } : {}),
				text: update.text,
			});
			break;
		}
		case "image": {
			if (update.role === "assistant") {
				entry.isStreaming = true;
				appendAssistantBlock(entry, { type: "image", ...update.image });
				entry.stats.totalMessages = entry.messages.length;
				publishEvent({
					type: "image",
					...(update.messageId ? { messageId: update.messageId } : {}),
					image: { type: "image", ...update.image },
				});
				break;
			}
			const echo = entry.pendingUserEcho;
			const imageIndex = echo?.images.findIndex(
				(expected, index) =>
					!echo.matchedImages[index] &&
					expected?.data === update.image.data &&
					expected.mimeType === update.image.mimeType,
			);
			if (echo && imageIndex !== undefined && imageIndex >= 0) {
				echo.matchedImages[imageIndex] = true;
				if (userEchoComplete(echo)) delete entry.pendingUserEcho;
				break;
			}
			delete entry.pendingUserEcho;
			appendUserBlock(entry, { type: "image", ...update.image });
			entry.stats.totalMessages = entry.messages.length;
			publishEvent({
				type: "message_start",
				message: entry.messages.at(-1) as TranscriptMessage,
			});
			break;
		}
		case "thinking": {
			entry.isStreaming = true;
			appendAssistantBlock(entry, { type: "thinking", thinking: update.text });
			publishEvent({
				type: "thinking",
				...(update.messageId ? { messageId: update.messageId } : {}),
				text: update.text,
			});
			break;
		}
		case "tool-call": {
			const rawToolName = update.toolName ?? update.title ?? "tool";
			const toolName = rawToolName.endsWith("__ask_user_question")
				? "ask_user_question"
				: rawToolName;
			appendAssistantBlock(entry, {
				type: "toolCall",
				id: update.toolCallId,
				toolName,
				name: toolName,
				arguments: update.rawInput ?? {},
			});
			entry.stats.totalMessages = entry.messages.length;
			publishEvent({
				type: "tool-start",
				toolCallId: update.toolCallId,
				toolName,
				tool: update.rawInput ?? {},
			});
			break;
		}
		case "tool-update": {
			const finished =
				update.status === "completed" || update.status === "error" || update.status === "failed";
			const result = update.rawOutput ?? update.content ?? update.error;
			if (finished)
				entry.messages.push({
					role: "toolResult",
					toolCallId: update.toolCallId,
					...(update.status === "error" || update.status === "failed" ? { isError: true } : {}),
					content: result,
					details: update.raw,
				});
			publishEvent({
				type: finished ? "tool-end" : "tool-update",
				toolCallId: update.toolCallId,
				...(update.status ? { status: update.status } : {}),
				tool: result,
			});
			break;
		}
		case "usage": {
			const usage = update.usage;
			const totalDelta =
				usage.totalTokens ??
				(usage.inputTokens ?? 0) +
					(usage.outputTokens ?? 0) +
					(usage.cacheReadTokens ?? 0) +
					(usage.cacheWriteTokens ?? 0);
			entry.stats.tokens.input += usage.inputTokens ?? 0;
			entry.stats.tokens.output += usage.outputTokens ?? 0;
			entry.stats.tokens.cacheRead += usage.cacheReadTokens ?? 0;
			entry.stats.tokens.cacheWrite += usage.cacheWriteTokens ?? 0;
			entry.stats.tokens.total += totalDelta;
			entry.stats.cost += usage.cost ?? 0;
			entry.stats.reported = {
				...entry.stats.reported,
				...(usage.inputTokens === undefined ? {} : { input: true }),
				...(usage.outputTokens === undefined ? {} : { output: true }),
				...(usage.cacheReadTokens === undefined ? {} : { cacheRead: true }),
				...(usage.cacheWriteTokens === undefined ? {} : { cacheWrite: true }),
				...(usage.totalTokens === undefined && totalDelta === 0 ? {} : { total: true }),
				...(usage.cost === undefined ? {} : { cost: true }),
			};
			publishEvent({
				type: "usage",
				usage: { ...entry.stats.tokens, cost: entry.stats.cost },
				reported: entry.stats.reported,
			});
			break;
		}
		case "context-usage": {
			entry.stats.tokens.input = update.usage.accumulatedInputTokens;
			entry.stats.tokens.output = update.usage.accumulatedOutputTokens;
			entry.stats.tokens.total =
				entry.stats.tokens.input +
				entry.stats.tokens.output +
				entry.stats.tokens.cacheRead +
				entry.stats.tokens.cacheWrite;
			if (update.usage.accumulatedCost !== undefined) {
				entry.stats.cost = update.usage.accumulatedCost;
			}
			entry.stats.reported = {
				...entry.stats.reported,
				input: true,
				output: true,
				total: true,
				...(update.usage.accumulatedCost === undefined ? {} : { cost: true }),
			};
			const percent = update.usage.contextLimit
				? (update.usage.used / update.usage.contextLimit) * 100
				: null;
			entry.stats.contextUsage = {
				tokens: update.usage.used,
				contextWindow: update.usage.contextLimit,
				percent,
			};
			publishEvent({ type: "context", contextUsage: entry.stats.contextUsage });
			break;
		}
		case "config":
			entry.configOptions = update.configOptions;
			entry.thinkingLevel = thinkingFrom(update.configOptions);
			publishEvent({ type: "config", configOptions: update.configOptions });
			break;
		case "session-info":
			entry.title = update.session.title ?? entry.title;
			if (update.activeRunId === null) delete entry.runId;
			else if (update.activeRunId !== undefined) entry.runId = update.activeRunId;
			publishEvent({ type: "session-info", title: entry.title });
			break;
		case "status": {
			if (/error|fail/i.test(update.status)) {
				entry.isStreaming = false;
				entry.lastSettlement = { stopReason: "error", errorMessage: update.message };
				publishEvent({ type: "error", error: update.message });
			} else if (/complete|idle|done|cancel/i.test(update.status)) {
				entry.isStreaming = false;
				entry.lastSettlement = { stopReason: update.status };
				publishEvent({ type: "complete", status: update.status });
			}
			break;
		}
	}
}

export interface CreateSessionInput {
	cwd: string;
	projectId: string;
	model?: WireModel;
	thinkingLevel?: ThinkingLevel;
}
export interface CreateSessionResult {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const cwd = assertMountedDirectory(input.cwd, "Session workspace");
	const token = randomUUID();
	const info = await client().createSession({
		cwd,
		projectId: input.projectId,
		mcpServers: objectiveMcp(token),
	});
	const entry = entryFrom(info, input.projectId, cwd);
	entry.objectiveToken = token;
	entry.attachedGeneration = client().connectionGeneration;
	sessions.set(info.session.sessionId, entry);
	recordProjectSession({ projectId: input.projectId, sessionId: info.session.sessionId, cwd });
	if (input.model) await setSessionModel(info.session.sessionId, input.model);
	if (input.thinkingLevel)
		await setSessionThinkingLevel(info.session.sessionId, input.thinkingLevel);
	return {
		sessionId: info.session.sessionId,
		model: entry.model,
		thinkingLevel: entry.thinkingLevel,
	};
}

export function hasSession(sessionId: string): boolean {
	return sessions.has(sessionId);
}
export function getSessionProjectId(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.projectId;
}
export function getSessionCwd(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.cwd;
}
export function isSessionStreaming(sessionId: string): boolean {
	return sessions.get(sessionId)?.isStreaming === true;
}

export async function ensureSessionAttached(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<boolean> {
	const attached = await withSessionOperation(sessionId, async () => {
		const admitted = assertMountedDirectory(cwd, "Session workspace");
		const existing = sessions.get(sessionId);
		if (existing) {
			if (existing.projectId !== projectId || existing.cwd !== admitted) return false;
			await attachSession(sessionId, existing);
			return true;
		}
		const record = loadProjectSessionRecords().find(
			(candidate) =>
				candidate.projectId === projectId &&
				candidate.sessionId === sessionId &&
				candidate.cwd === admitted,
		);
		if (!record) return false;
		const placeholder: Entry = {
			projectId,
			cwd: admitted,
			title: "Chat",
			model: null,
			thinkingLevel: "off",
			configOptions: [],
			messages: [],
			isStreaming: false,
			stats: emptyStats(sessionId),
			queue: { steering: [], followUp: [] },
			promptGeneration: 0,
			consumedQuestionToolCalls: new Set(),
			objectiveToken: randomUUID(),
		};
		sessions.set(sessionId, placeholder);
		try {
			await attachSession(sessionId, placeholder);
			return true;
		} catch (error) {
			if (sessions.get(sessionId) === placeholder) sessions.delete(sessionId);
			throw error;
		}
	});
	const entry = sessions.get(sessionId);
	if (attached && entry && !entry.isStreaming && entry.queue.followUp.length > 0) {
		scheduleFollowUpDrain(sessionId);
	}
	return attached;
}

function summary(sessionId: string, entry: Entry): SessionSummary {
	return {
		sessionId,
		projectId: entry.projectId,
		cwd: entry.cwd,
		title: entry.title,
		model: entry.model,
		thinkingLevel: entry.thinkingLevel,
		isStreaming: entry.isStreaming,
		messageCount: entry.messages.length,
		updatedAt: Date.now(),
		live: true,
		archived: false,
		queue: { steering: [...entry.queue.steering], followUp: [...entry.queue.followUp] },
		...(entry.lastSettlement !== undefined ? { lastSettlement: entry.lastSettlement } : {}),
	};
}
export async function listSessions(
	projectId: string,
	archived: boolean | "all" = false,
): Promise<SessionSummary[]> {
	const records = loadProjectSessionRecords().filter((record) => record.projectId === projectId);
	const byId = new Map<
		string,
		Awaited<ReturnType<GooseClient["listSessions"]>>["sessions"][number]
	>();
	const confirmedMissing = new Set<string>();
	let cursor: string | undefined;
	const seenCursors = new Set<string>();
	for (let page = 0; page < 20; page++) {
		const remote = await client().listSessions({
			limit: 100,
			...(cursor === undefined ? {} : { cursor }),
		});
		for (const session of remote.sessions) byId.set(session.sessionId, session);
		if (!remote.nextCursor) break;
		if (seenCursors.has(remote.nextCursor))
			throw new Error("Goose session list was truncated because it repeated a cursor");
		cursor = remote.nextCursor;
		seenCursors.add(cursor);
		if (page === 19) throw new Error("Goose session list was truncated after 20 pages");
	}
	const missing = records.filter((record) => !byId.has(record.sessionId));
	if (missing.length > SESSION_INFO_MAX_FALLBACKS) {
		throw new Error(
			`Goose session list requires more than ${SESSION_INFO_MAX_FALLBACKS} per-session lookups`,
		);
	}
	for (let offset = 0; offset < missing.length; offset += SESSION_INFO_BATCH_SIZE) {
		await Promise.all(
			missing.slice(offset, offset + SESSION_INFO_BATCH_SIZE).map(async (record) => {
				try {
					const info = await client().sessionInfo(record.sessionId);
					byId.set(record.sessionId, info.session);
				} catch (error) {
					if (!isGooseResourceNotFound(error)) throw error;
					confirmedMissing.add(record.sessionId);
					// Confirmed stale project records are omitted. Goose remains authoritative for existence.
				}
			}),
		);
	}
	return records.flatMap((record) => {
		if (confirmedMissing.has(record.sessionId)) {
			const live = sessions.get(record.sessionId);
			if (
				(sessionOperationCounts.get(record.sessionId) ?? 0) === 0 &&
				!live?.isStreaming &&
				!live?.attachment &&
				!live?.replay
			) {
				clearSessionProjection(record.sessionId);
			}
			return [];
		}
		const source = byId.get(record.sessionId);
		if (source?.archived) {
			if (archived === false) return [];
			return [
				{
					sessionId: record.sessionId,
					projectId,
					cwd: record.cwd,
					title: source.title ?? "Chat",
					model: null,
					thinkingLevel: "off",
					isStreaming: false,
					messageCount: source.messageCount ?? 0,
					updatedAt: source.updatedAt ? Date.parse(source.updatedAt) || Date.now() : Date.now(),
					live: false,
					archived: true,
				},
			];
		}
		if (archived === true) return [];
		const live = sessions.get(record.sessionId);
		if (live) return [summary(record.sessionId, live)];
		if (!source) return [];
		return [
			{
				sessionId: record.sessionId,
				projectId,
				cwd: record.cwd,
				title: source.title ?? "Chat",
				model: null,
				thinkingLevel: "off",
				isStreaming: false,
				messageCount: source.messageCount ?? 0,
				updatedAt: source.updatedAt ? Date.parse(source.updatedAt) || Date.now() : Date.now(),
				live: false,
				archived: false,
			},
		];
	});
}
export async function getSessionMessages(
	sessionId: string,
	projectId: string,
	cwd: string,
	options: { historyIndex?: boolean } = {},
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	if (!options.historyIndex) historyIndexOwnedSessions.delete(sessionId);
	if (!(await ensureSessionAttached(sessionId, projectId, cwd)))
		throw new Error(`Unknown session: ${sessionId}`);
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	return { summary: summary(sessionId, entry), messages: entry.messages };
}

function searchableMessageText(message: TranscriptMessage): string {
	if (message.role === "toolResult") return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.flatMap((block) => {
			if (block.type === "text") return [block.text];
			if (block.type === "thinking" && message.role === "assistant") return [block.thinking];
			return [];
		})
		.join("\n")
		.trim();
}

function historySnippet(text: string, normalizedQuery: string): string {
	if (!normalizedQuery) return text.slice(0, 240);
	const index = text.toLocaleLowerCase().indexOf(normalizedQuery);
	if (index < 0) return text.slice(0, 240);
	const start = Math.max(0, index - 80);
	const end = Math.min(text.length, index + normalizedQuery.length + 120);
	return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

async function indexHistoryRecord(
	record: {
		projectId: string;
		sessionId: string;
		cwd: string;
	},
	source: { title?: string; updatedAt?: string; createdAt?: string },
): Promise<void> {
	const loaded = sessions.has(record.sessionId);
	let indexedEntry: Entry | undefined;
	const sourceTimestamp = historyTimestamp(source);
	if (historySearchIndex.get(record.sessionId)?.timestamp === sourceTimestamp && !loaded) return;
	const failure = historyIndexFailures.get(record.sessionId);
	if (failure && (failure.attempts >= HISTORY_INDEX_MAX_ATTEMPTS || failure.retryAt > Date.now())) {
		return;
	}
	const active = historyIndexing.get(record.sessionId);
	if (active) return active;
	if (!loaded) historyIndexOwnedSessions.add(record.sessionId);
	const task = getSessionMessages(record.sessionId, record.projectId, record.cwd, {
		historyIndex: true,
	})
		.then(({ summary: loadedSummary, messages }) => {
			indexedEntry = sessions.get(record.sessionId);
			if (historySuppressedSessions.has(record.sessionId)) return;
			let remainingChars = HISTORY_INDEX_MAX_TEXT_CHARS;
			const indexedMessages: HistoryIndexEntry["messages"] = [];
			const first = Math.max(0, messages.length - HISTORY_INDEX_MAX_MESSAGES);
			for (
				let messageIndex = first;
				messageIndex < messages.length && remainingChars > 0;
				messageIndex++
			) {
				const message = messages[messageIndex];
				if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
				const text = searchableMessageText(message).slice(
					0,
					Math.min(HISTORY_INDEX_MAX_MESSAGE_CHARS, remainingChars),
				);
				if (!text) continue;
				remainingChars -= text.length;
				indexedMessages.push({ role: message.role, text, messageIndex });
			}
			const entry: HistoryIndexEntry = {
				projectId: record.projectId,
				sessionId: record.sessionId,
				cwd: record.cwd,
				title: source.title ?? loadedSummary.title,
				timestamp: sourceTimestamp,
				messages: indexedMessages,
			};
			historySearchIndex.delete(record.sessionId);
			historySearchIndex.set(record.sessionId, entry);
			while (historySearchIndex.size > HISTORY_INDEX_MAX_SESSIONS) {
				const oldest = historySearchIndex.keys().next().value;
				if (typeof oldest !== "string") break;
				historySearchIndex.delete(oldest);
			}
			historyIndexFailures.delete(record.sessionId);
		})
		.catch(() => {
			const attempts = (historyIndexFailures.get(record.sessionId)?.attempts ?? 0) + 1;
			historyIndexFailures.set(record.sessionId, {
				attempts,
				retryAt: Date.now() + Math.min(5_000, 300 * 2 ** (attempts - 1)),
			});
		})
		.finally(() => {
			historyIndexing.delete(record.sessionId);
			if (
				!loaded &&
				historyIndexOwnedSessions.has(record.sessionId) &&
				sessions.get(record.sessionId) === indexedEntry
			) {
				sessions.delete(record.sessionId);
			}
			historyIndexOwnedSessions.delete(record.sessionId);
		});
	historyIndexing.set(record.sessionId, task);
	return task;
}

function historyTimestamp(source: { updatedAt?: string; createdAt?: string }): number {
	const value = source.updatedAt ?? source.createdAt;
	const parsed = value ? Date.parse(value) : 0;
	return Number.isFinite(parsed) ? parsed : 0;
}

export async function searchSessionHistory(input: {
	query: string;
	scope: HistoryScope;
	limit?: number;
}): Promise<HistorySearchResult> {
	if (typeof input.query !== "string") throw new Error("History query must be text");
	const query = input.query.trim();
	if (query.length > MAX_HISTORY_QUERY_LENGTH) {
		throw new Error(`History query must be ${MAX_HISTORY_QUERY_LENGTH} characters or fewer`);
	}
	const limit = Math.min(
		MAX_HISTORY_LIMIT,
		Math.max(1, Number.isSafeInteger(input.limit) ? (input.limit as number) : 50),
	);
	let records = loadProjectSessionRecords();
	if (input.scope.kind === "chat") {
		const { sessionId } = input.scope;
		records = records.filter((record) => record.sessionId === sessionId);
	} else if (input.scope.kind === "project") {
		const { projectId } = input.scope;
		records = records.filter((record) => record.projectId === projectId);
	} else if (input.scope.kind !== "all") {
		throw new Error("Invalid history scope");
	}
	const remote = await client().listSessions({ limit: HISTORY_INDEX_MAX_SESSIONS });
	const remoteById = new Map(remote.sessions.map((session) => [session.sessionId, session]));
	const remoteOrder = new Map(remote.sessions.map((session, index) => [session.sessionId, index]));
	records = records
		.filter((record) => !remoteById.get(record.sessionId)?.archived)
		.filter((record) => remoteById.has(record.sessionId))
		.sort(
			(a, b) =>
				historyTimestamp(remoteById.get(b.sessionId) ?? {}) -
					historyTimestamp(remoteById.get(a.sessionId) ?? {}) ||
				(remoteOrder.get(a.sessionId) ?? Number.MAX_SAFE_INTEGER) -
					(remoteOrder.get(b.sessionId) ?? Number.MAX_SAFE_INTEGER),
		)
		.slice(0, HISTORY_INDEX_MAX_SESSIONS);

	const indexable = records.filter((record) => {
		const source = remoteById.get(record.sessionId);
		const cached = historySearchIndex.get(record.sessionId);
		if (
			sessions.has(record.sessionId) ||
			!cached ||
			cached.timestamp !== historyTimestamp(source ?? {})
		) {
			const failure = historyIndexFailures.get(record.sessionId);
			return (
				!failure || (failure.attempts < HISTORY_INDEX_MAX_ATTEMPTS && failure.retryAt <= Date.now())
			);
		}
		return false;
	});
	await Promise.all(
		indexable
			.slice(0, HISTORY_INDEX_BATCH_SIZE)
			.map((record) => indexHistoryRecord(record, remoteById.get(record.sessionId) ?? {})),
	);
	const indexing = records.some((record) => {
		const source = remoteById.get(record.sessionId);
		const cached = historySearchIndex.get(record.sessionId);
		if (cached && cached.timestamp === historyTimestamp(source ?? {})) {
			return false;
		}
		const failure = historyIndexFailures.get(record.sessionId);
		return !failure || failure.attempts < HISTORY_INDEX_MAX_ATTEMPTS;
	});
	const incomplete = records.some(
		(record) =>
			(historyIndexFailures.get(record.sessionId)?.attempts ?? 0) >= HISTORY_INDEX_MAX_ATTEMPTS,
	);
	const normalizedQuery = query.toLocaleLowerCase();
	const prompts: HistorySearchResult["prompts"] = [];
	const messages: HistorySearchResult["messages"] = [];
	let promptTotal = 0;
	let messageTotal = 0;
	for (const record of records) {
		const entry = historySearchIndex.get(record.sessionId);
		if (!entry) continue;
		for (let index = entry.messages.length - 1; index >= 0; index--) {
			const message = entry.messages[index];
			if (!message) continue;
			const { text, messageIndex } = message;
			const matches = !normalizedQuery || text.toLocaleLowerCase().includes(normalizedQuery);
			if (!matches) continue;
			const shared = {
				text,
				timestamp: entry.timestamp,
				sessionId: record.sessionId,
				sessionTitle: entry.title,
				projectId: record.projectId,
				cwd: record.cwd,
				messageIndex,
				anchorText: text,
			};
			if (message.role === "user") {
				promptTotal++;
				if (prompts.length < limit) prompts.push(shared);
			}
			messageTotal++;
			if (messages.length < limit) {
				messages.push({
					...shared,
					role: message.role,
					snippet: historySnippet(text, normalizedQuery),
				});
			}
		}
	}
	return {
		prompts,
		messages,
		promptTotal,
		messageTotal,
		indexing,
		incomplete,
	};
}
function requireEntry(sessionId: string): Entry {
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	historyIndexOwnedSessions.delete(sessionId);
	return entry;
}

function beginSessionOperation(sessionId: string): () => void {
	if (archivingSessions.has(sessionId)) {
		throw new Error("Wait for the chat archive operation to finish");
	}
	sessionOperationCounts.set(sessionId, (sessionOperationCounts.get(sessionId) ?? 0) + 1);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		const remaining = (sessionOperationCounts.get(sessionId) ?? 1) - 1;
		if (remaining > 0) sessionOperationCounts.set(sessionId, remaining);
		else sessionOperationCounts.delete(sessionId);
	};
}

async function withSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
	const release = beginSessionOperation(sessionId);
	try {
		return await operation();
	} finally {
		release();
	}
}

/**
 * Goose keeps loaded session state per ACP connection. Serialize a load for
 * each entry and generation so reconnecting requests cannot race duplicate
 * loads or issue a session-specific request against an unattached transport.
 */
async function attachSession(
	sessionId: string,
	entry: Entry,
	options: { drainQueue?: boolean } = {},
): Promise<void> {
	const goose = client();
	await goose.ready();
	const generation = goose.connectionGeneration;
	if (!generation) throw new Error("Goose ACP connection is not ready");
	if (entry.attachedGeneration === generation) return;
	if (entry.attachment?.generation === generation) return entry.attachment.promise;

	const replay = freshReplay(entry, sessionId);
	const promise = (async () => {
		entry.replay = replay;
		const info = await goose.loadSession(sessionId, entry.cwd, {
			mcpServers: objectiveMcp(entry.objectiveToken),
		});
		if (goose.connectionGeneration !== generation)
			throw new Error("Goose ACP connection changed while loading the session");
		replay.title = info.session.title ?? replay.title;
		replay.model = modelFrom(info);
		replay.thinkingLevel = thinkingFrom(info.configOptions);
		replay.configOptions = info.configOptions;
		replay.attachedGeneration = generation;
		replay.stats.totalMessages = replay.messages.length;
		commitReplay(entry, replay);
	})();
	entry.attachment = { generation, promise };
	try {
		await promise;
	} finally {
		if (entry.replay === replay) entry.replay = undefined;
		if (entry.attachment?.promise === promise) entry.attachment = undefined;
	}
	if (options.drainQueue !== false && !entry.isStreaming && entry.queue.followUp.length > 0) {
		scheduleFollowUpDrain(sessionId);
	}
}

function freshReplay(entry: Entry, sessionId: string): Entry {
	return {
		...entry,
		messages: [],
		isStreaming: false,
		lastSettlement: undefined,
		stats: emptyStats(sessionId),
		runId: undefined,
		pendingUserEcho: undefined,
		attachedGeneration: undefined,
		attachment: undefined,
		replay: undefined,
	};
}

function commitReplay(entry: Entry, replay: Entry): void {
	entry.title = replay.title;
	entry.model = replay.model;
	entry.thinkingLevel = replay.thinkingLevel;
	entry.configOptions = replay.configOptions;
	entry.messages = replay.messages;
	entry.isStreaming = replay.isStreaming;
	entry.lastSettlement = replay.lastSettlement;
	entry.stats = replay.stats;
	entry.runId = replay.runId;
	entry.pendingUserEcho = replay.pendingUserEcho;
	entry.attachedGeneration = replay.attachedGeneration;
}

function gooseImages(images: ImageContent[] = []) {
	return images.map(({ data, mimeType }) => ({ data, mimeType }));
}
function userEchoComplete(echo: NonNullable<Entry["pendingUserEcho"]>): boolean {
	return echo.offset >= echo.text.length && echo.matchedImages.every(Boolean);
}
function attachedRequest(entry: Entry): { connectionGeneration: number } {
	if (!entry.attachedGeneration) throw new Error("Goose session is not attached");
	return { connectionGeneration: entry.attachedGeneration };
}

const MAX_QUEUED_MESSAGES = 20;

function queuedText(value: string): string {
	const text = value.trim();
	if (!text) throw new Error("Queued message cannot be empty");
	return text;
}

function emitQueue(sessionId: string, entry: Entry): void {
	emit(sessionId, {
		type: "queue_update",
		steering: [...entry.queue.steering],
		followUp: [...entry.queue.followUp],
	});
}

function startPrompt(sessionId: string, entry: Entry, text: string, images?: ImageContent[]): void {
	const promptGeneration = ++entry.promptGeneration;
	entry.messages.push({
		role: "user",
		content: images?.length ? [{ type: "text", text }, ...images] : text,
	});
	entry.pendingUserEcho = {
		text,
		offset: 0,
		images: images ?? [],
		matchedImages: (images ?? []).map(() => false),
	};
	entry.stats.totalMessages = entry.messages.length;
	entry.isStreaming = true;
	emit(sessionId, { type: "run-start" });
	void client()
		.prompt(sessionId, text, gooseImages(images), attachedRequest(entry))
		.then((result) => {
			if (sessions.get(sessionId) !== entry || entry.promptGeneration !== promptGeneration) return;
			entry.isStreaming = false;
			entry.lastSettlement = { stopReason: result.stopReason ?? "complete" };
			emit(sessionId, {
				type: "complete",
				...(result.stopReason ? { status: result.stopReason } : {}),
			});
			scheduleFollowUpDrain(sessionId);
		})
		.catch((error: unknown) => {
			if (sessions.get(sessionId) !== entry || entry.promptGeneration !== promptGeneration) return;
			entry.isStreaming = false;
			const message = error instanceof Error ? error.message : String(error);
			entry.lastSettlement = { stopReason: "error", errorMessage: message };
			emit(sessionId, { type: "error", error: message });
		});
}

function scheduleFollowUpDrain(sessionId: string): void {
	if (followUpDrainTimers.has(sessionId)) return;
	const timer = setTimeout(() => {
		followUpDrainTimers.delete(sessionId);
		void drainFollowUpQueue(sessionId).catch(() => {
			// Attachment failures retain the queued item. The next ACP attachment retries it.
		});
	}, 0);
	timer.unref?.();
	followUpDrainTimers.set(sessionId, timer);
}

async function drainFollowUpQueue(sessionId: string): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		if (entry.isStreaming) return;
		if (entry.queue.followUp.length === 0) return;
		await attachSession(sessionId, entry, { drainQueue: false });
		if (entry.isStreaming) return;
		const text = entry.queue.followUp.shift();
		if (!text) return;
		emitQueue(sessionId, entry);
		startPrompt(sessionId, entry, text);
	});
}

export async function queueSessionMessage(sessionId: string, value: string): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		const text = queuedText(value);
		await attachSession(sessionId, entry);
		if (!entry.isStreaming) {
			startPrompt(sessionId, entry, text);
			return;
		}
		if (entry.queue.followUp.length >= MAX_QUEUED_MESSAGES) {
			throw new Error(`A chat can queue at most ${MAX_QUEUED_MESSAGES} messages`);
		}
		entry.queue.followUp.push(text);
		emitQueue(sessionId, entry);
	});
}

function mutableQueueLane(entry: Entry, lane: QueueLane): string[] {
	if (lane !== "steering" && lane !== "followUp") throw new Error("Unknown queue lane");
	return entry.queue[lane];
}

export async function editSessionQueue(
	sessionId: string,
	lane: QueueLane,
	index: number,
	value: string,
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		const queue = mutableQueueLane(entry, lane);
		if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
			throw new Error("Queued message not found");
		}
		queue[index] = queuedText(value);
		emitQueue(sessionId, entry);
	});
}

export async function removeSessionQueue(
	sessionId: string,
	lane: QueueLane,
	index: number,
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		const queue = mutableQueueLane(entry, lane);
		if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
			throw new Error("Queued message not found");
		}
		queue.splice(index, 1);
		emitQueue(sessionId, entry);
	});
}

export async function promptSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		await attachSession(sessionId, entry);
		startPrompt(sessionId, entry, text, images);
	});
}
export async function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		await attachSession(sessionId, entry);
		if (!entry.runId) throw new Error("Goose has not supplied a steerable run id.");
		const result = await client().steer(
			sessionId,
			entry.runId,
			text,
			gooseImages(images),
			attachedRequest(entry),
		);
		entry.runId = result.runId;
	});
}
export async function abortSession(sessionId: string): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		cancelPermissions(sessionId);
		await attachSession(sessionId, requireEntry(sessionId));
		await client().cancel(sessionId, attachedRequest(requireEntry(sessionId)));
	});
}
export async function setSessionModel(sessionId: string, model: WireModel): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		await attachSession(sessionId, entry);
		if (entry.model?.provider === model.provider && entry.model.id === model.id) return;
		let options = entry.configOptions;
		if (entry.model?.provider !== model.provider)
			options = await client().setProvider(sessionId, model.provider, attachedRequest(entry));
		options = await client().setModel(sessionId, model.id, attachedRequest(entry));
		entry.model = model;
		entry.configOptions = options;
	});
}
export async function setSessionThinkingLevel(
	sessionId: string,
	level: ThinkingLevel,
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		await attachSession(sessionId, entry);
		entry.configOptions = await client().setThinking(sessionId, level, attachedRequest(entry));
		entry.thinkingLevel = level;
	});
}
export function clampSessionThinkingLevel(
	sessionId: string,
	requested: ThinkingLevel,
): ThinkingLevel {
	const option = requireEntry(sessionId).configOptions.find(
		(candidate) => candidate.id === "thinking_effort",
	);
	const values = option?.values.map((value) => value.value).filter(Boolean) ?? [];
	if (values.length === 0)
		return typeof option?.currentValue === "string" ? option.currentValue : "off";
	if (values.includes(requested)) return requested;
	const scale = ["off", "minimal", "low", "medium", "high", "xhigh"];
	const requestedIndex = Math.max(0, scale.indexOf(requested));
	return values.reduce((closest, value) =>
		Math.abs(scale.indexOf(value) - requestedIndex) <
		Math.abs(scale.indexOf(closest) - requestedIndex)
			? value
			: closest,
	);
}
export function getSessionStats(sessionId: string): SessionStats {
	return requireEntry(sessionId).stats;
}
export function sessionForObjectiveToken(
	token: string,
): { projectId: string; sessionId: string } | undefined {
	for (const [sessionId, entry] of sessions)
		if (entry.objectiveToken === token) return { projectId: entry.projectId, sessionId };
	return undefined;
}

function questionArgs(value: unknown): AskUserQuestionArgs {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Question arguments must be an object");
	}
	const questions = Reflect.get(value, "questions");
	if (!Array.isArray(questions) || questions.length === 0 || questions.length > 8) {
		throw new Error("Ask between 1 and 8 questions");
	}
	for (const question of questions) {
		if (!question || typeof question !== "object" || Array.isArray(question)) {
			throw new Error("Question entries must be objects");
		}
		const prompt = Reflect.get(question, "question");
		const header = Reflect.get(question, "header");
		const options = Reflect.get(question, "options");
		if (
			typeof prompt !== "string" ||
			!prompt.trim() ||
			prompt.length > 2_000 ||
			typeof header !== "string" ||
			!header.trim() ||
			header.length > 200 ||
			!Array.isArray(options) ||
			options.length === 0 ||
			options.length > 12
		) {
			throw new Error("Question text, header, or options are invalid");
		}
		for (const option of options) {
			if (
				!option ||
				typeof option !== "object" ||
				Array.isArray(option) ||
				typeof Reflect.get(option, "label") !== "string" ||
				!(Reflect.get(option, "label") as string).trim() ||
				typeof Reflect.get(option, "description") !== "string"
			) {
				throw new Error("Question options are invalid");
			}
		}
	}
	return value as AskUserQuestionArgs;
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function latestQuestionToolCall(entry: Entry, args: AskUserQuestionArgs): string | undefined {
	const wanted = stableJson(args);
	for (let messageIndex = entry.messages.length - 1; messageIndex >= 0; messageIndex--) {
		const message = entry.messages[messageIndex];
		if (message?.role !== "assistant") continue;
		for (let blockIndex = message.content.length - 1; blockIndex >= 0; blockIndex--) {
			const block = message.content[blockIndex];
			if (
				block?.type === "toolCall" &&
				block.name === "ask_user_question" &&
				!entry.consumedQuestionToolCalls.has(block.id) &&
				stableJson(block.arguments) === wanted
			) {
				return block.id;
			}
		}
	}
	return undefined;
}

export async function askSessionQuestion(
	sessionId: string,
	value: unknown,
): Promise<AskUserQuestionResult> {
	const entry = requireEntry(sessionId);
	const args = questionArgs(value);
	let toolCallId: string | undefined;
	for (let attempt = 0; attempt < 40; attempt++) {
		if (sessions.get(sessionId) !== entry) throw new Error("Question session is no longer active");
		toolCallId = latestQuestionToolCall(entry, args);
		if (toolCallId) break;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	if (!toolCallId) throw new Error("No matching ask_user_question tool call is active");
	entry.consumedQuestionToolCalls.add(toolCallId);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			if (!pendingQuestions.delete(toolCallId)) return;
			resolve({ answers: [], cancelled: true });
		}, QUESTION_TIMEOUT_MS);
		timer.unref?.();
		pendingQuestions.set(toolCallId, { sessionId, args, resolve, timer });
	});
}

function validateQuestionResult(result: AskUserQuestionResult, args: AskUserQuestionArgs): void {
	if (!result || !Array.isArray(result.answers) || typeof result.cancelled !== "boolean") {
		throw new Error("Malformed question response");
	}
	if (result.answers.length > args.questions.length) throw new Error("Too many question answers");
	const seen = new Set<number>();
	for (const answer of result.answers) {
		const question = args.questions[answer.questionIndex];
		const optionLabels = new Set(question?.options.map((option) => option.label) ?? []);
		const selectedOption = question?.options.find((option) => option.label === answer.answer);
		if (
			!answer ||
			typeof answer !== "object" ||
			!Number.isInteger(answer.questionIndex) ||
			answer.questionIndex < 0 ||
			answer.questionIndex >= args.questions.length ||
			seen.has(answer.questionIndex) ||
			answer.question !== question?.question ||
			(answer.kind !== "option" && answer.kind !== "custom" && answer.kind !== "multi") ||
			(answer.answer !== null &&
				(typeof answer.answer !== "string" || answer.answer.length > 8_000)) ||
			(answer.selected !== undefined &&
				(!Array.isArray(answer.selected) ||
					answer.selected.length > 12 ||
					answer.selected.some((item) => typeof item !== "string" || item.length > 500))) ||
			(answer.notes !== undefined &&
				(typeof answer.notes !== "string" || answer.notes.length > 8_000)) ||
			(answer.preview !== undefined &&
				(typeof answer.preview !== "string" || answer.preview.length > 8_000)) ||
			(answer.kind === "option" &&
				(!selectedOption || answer.preview !== selectedOption.preview)) ||
			(answer.kind !== "option" && answer.preview !== undefined) ||
			(answer.kind === "multi" &&
				(!answer.selected || answer.selected.some((label) => !optionLabels.has(label))))
		) {
			throw new Error("Malformed question response");
		}
		seen.add(answer.questionIndex);
	}
}

export function resolveSessionQuestion(
	sessionId: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): void {
	const pending = pendingQuestions.get(toolCallId);
	if (!pending || pending.sessionId !== sessionId)
		throw new Error("Question is no longer awaiting input");
	validateQuestionResult(result, pending.args);
	clearTimeout(pending.timer);
	pendingQuestions.delete(toolCallId);
	pending.resolve(result);
}
function slashCommand(
	command: import("@gooseberry/goose-client").GooseSlashCommand,
): SlashCommandInfo {
	return {
		name: command.name,
		...(command.description ? { description: command.description } : {}),
		source: "goose",
		sourceInfo: {
			path: command.name,
			source: "Goose",
			scope: "temporary",
			origin: "top-level",
		},
	};
}
export async function getSessionCommands(sessionId: string): Promise<SlashCommandInfo[]> {
	return withSessionOperation(sessionId, async () => {
		const entry = requireEntry(sessionId);
		await attachSession(sessionId, entry);
		return client()
			.listSlashCommands({ sessionId }, attachedRequest(entry))
			.then((commands) => commands.map(slashCommand));
	});
}
export function getCommandsForCwd(cwd: string): Promise<SlashCommandInfo[]> {
	return client()
		.listSlashCommands({ cwd })
		.then((commands) => commands.map(slashCommand));
}

function clearSessionProjection(sessionId: string): void {
	const drainTimer = followUpDrainTimers.get(sessionId);
	if (drainTimer) clearTimeout(drainTimer);
	followUpDrainTimers.delete(sessionId);
	cancelPermissions(sessionId);
	for (const [toolCallId, pending] of pendingQuestions) {
		if (pending.sessionId !== sessionId) continue;
		clearTimeout(pending.timer);
		pendingQuestions.delete(toolCallId);
		pending.resolve({ answers: [], cancelled: true });
	}
	historyIndexOwnedSessions.delete(sessionId);
	sessions.delete(sessionId);
	historySearchIndex.delete(sessionId);
	historyIndexFailures.delete(sessionId);
}

export async function renameSession(
	sessionId: string,
	projectId: string,
	cwd: string,
	title: string,
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		const normalizedTitle = normalizeSessionTitle(title);
		const admitted = assertMountedDirectory(cwd, "Session workspace");
		const entry = sessions.get(sessionId);
		if (entry && (entry.projectId !== projectId || entry.cwd !== admitted)) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		await client().renameSession(sessionId, normalizedTitle);
		if (entry) entry.title = normalizedTitle;
		const indexed = historySearchIndex.get(sessionId);
		if (indexed) indexed.title = normalizedTitle;
		lifecyclePublisher({ projectId, sessionId, operation: "renamed", title: normalizedTitle });
	});
}

export async function archiveSession(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<void> {
	const admitted = assertMountedDirectory(cwd, "Session workspace");
	const entry = sessions.get(sessionId);
	if (entry && (entry.projectId !== projectId || entry.cwd !== admitted)) {
		throw new Error(`Unknown session: ${sessionId}`);
	}
	if (entry?.isStreaming) throw new Error("Stop the running chat before archiving it");
	if (
		archivingSessions.has(sessionId) ||
		(sessionOperationCounts.get(sessionId) ?? 0) > 0 ||
		entry?.attachment ||
		entry?.replay
	) {
		throw new Error("Wait for the chat to finish loading or updating");
	}
	archivingSessions.add(sessionId);
	try {
		await client().archiveSession(sessionId);
		historySuppressedSessions.add(sessionId);
		clearSessionProjection(sessionId);
		lifecyclePublisher({ projectId, sessionId, operation: "archived" });
	} finally {
		archivingSessions.delete(sessionId);
	}
}

export async function unarchiveSession(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		assertMountedDirectory(cwd, "Session workspace");
		await client().unarchiveSession(sessionId);
		historySuppressedSessions.delete(sessionId);
		lifecyclePublisher({ projectId, sessionId, operation: "unarchived" });
	});
}

export async function deleteSession(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<void> {
	await withSessionOperation(sessionId, async () => {
		if (!(await ensureSessionAttached(sessionId, projectId, cwd)))
			throw new Error(`Unknown session: ${sessionId}`);
		await attachSession(sessionId, requireEntry(sessionId));
		await client().deleteSession(sessionId, attachedRequest(requireEntry(sessionId)));
		historySuppressedSessions.add(sessionId);
		clearSessionProjection(sessionId);
		forgetProjectSession(projectId, sessionId);
		deletedPublisher({ projectId, sessionId });
	});
}
export function disposeAllSessions(): void {
	for (const pending of pendingPermissions.values()) pending.resolve("cancelled");
	for (const pending of pendingQuestions.values()) {
		clearTimeout(pending.timer);
		pending.resolve({ answers: [], cancelled: true });
	}
	pendingQuestions.clear();
	for (const timer of followUpDrainTimers.values()) clearTimeout(timer);
	followUpDrainTimers.clear();
	for (const login of pendingProviderLogins.values()) {
		if (login.expiresTimer) clearTimeout(login.expiresTimer);
		login.abortController.abort(new Error("Controller is shutting down"));
	}
	pendingProviderLogins.clear();
	for (const snapshot of providerLoginSnapshots.values()) clearTimeout(snapshot.expiresTimer);
	providerLoginSnapshots.clear();
	providerLoginClientReservations.clear();
	providerLoginProviderReservations.clear();
	historyIndexFailures.clear();
	historySearchIndex.clear();
	historyIndexOwnedSessions.clear();
	historySuppressedSessions.clear();
	historyIndexing.clear();
	sessionOperationCounts.clear();
	archivingSessions.clear();
	sessions.clear();
}
export async function settleSessionsForShutdown(): Promise<void> {
	await Promise.allSettled([...sessions.keys()].map((id) => abortSession(id)));
}

export async function listAvailableModels(): Promise<WireModel[]> {
	const hidden = new Set((getConfig().hiddenModels ?? []).map(modelReferenceKey));
	const providers = await client().listProviders();
	return providers
		.flatMap((provider): WireModel[] =>
			provider.models.map(
				(model): WireModel => ({
					id: model.id,
					name: model.name ?? model.id,
					provider: provider.id,
					...(model.contextLimit === undefined ? {} : { contextWindow: model.contextLimit }),
					...(model.reasoning === undefined ? {} : { reasoning: model.reasoning }),
					...(model.modalities === undefined
						? {}
						: { input: model.modalities.includes("image") ? ["text", "image"] : ["text"] }),
					available: provider.available !== false && provider.configured !== false,
					hidden: hidden.has(modelReferenceKey({ provider: provider.id, id: model.id })),
				}),
			),
		)
		.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}
export async function listProviderStatus(): Promise<
	import("@gooseberry/contracts").ProviderStatusReport
> {
	const providers = await client().listProviders();
	return {
		providers: providers
			.filter((provider) => provider.visibleInSetup !== false || provider.configured === true)
			.map((provider) => {
				const canOAuth = provider.configKeys.some((key) => key.oauthFlow);
				const canApiKey = provider.configKeys.some(
					(key) => !key.oauthFlow && (key.primary || key.required),
				);
				const configured = provider.configured === true;
				return {
					id: provider.id,
					name: provider.name ?? provider.id,
					configured,
					kind: configured
						? ("other" as const)
						: canOAuth
							? ("oauth" as const)
							: canApiKey
								? ("api-key" as const)
								: ("other" as const),
					...(provider.lastRefreshError
						? { detail: provider.lastRefreshError }
						: provider.available === false
							? { detail: "Provider runtime is unavailable" }
							: {}),
					canOAuth,
					canApiKey,
					canLogout: configured && provider.configKeys.length > 0,
					modelCount: provider.models.length,
					availableModelCount:
						!configured || provider.available === false ? 0 : provider.models.length,
				};
			}),
	};
}

async function completeProviderLogin(login: PendingProviderLogin): Promise<void> {
	if (login.abortController.signal.aborted) return;
	login.requestInFlight = true;
	publishProviderLogin(login, { kind: "progress", message: "Saving provider configuration…" });
	try {
		await client().saveProviderConfig(login.providerId, login.values, { timeoutMs: null });
		publishProviderLogin(login, { kind: "success" });
	} catch (error) {
		if (!login.abortController.signal.aborted) {
			publishProviderLogin(login, {
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	} finally {
		clearPendingProviderLogin(login);
	}
}

async function authenticateProviderLogin(login: PendingProviderLogin): Promise<void> {
	if (login.abortController.signal.aborted) return;
	login.requestInFlight = true;
	try {
		await client().authenticateProvider(login.providerId, {
			timeoutMs: null,
		});
		if (!login.abortController.signal.aborted) publishProviderLogin(login, { kind: "success" });
	} catch (error) {
		if (!login.abortController.signal.aborted) {
			publishProviderLogin(login, {
				kind: "error",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	} finally {
		clearPendingProviderLogin(login);
	}
}

export async function startProviderLogin(
	clientKey: string,
	providerId: string,
	type: "oauth" | "api_key",
): Promise<{ loginId: string; frame: LoginFrame }> {
	if (!providerId || providerId.includes("\0")) throw new Error("Invalid provider identifier");
	if (type !== "oauth" && type !== "api_key") throw new Error("Invalid provider login type");
	if (
		providerLoginClientReservations.has(clientKey) ||
		[...pendingProviderLogins.values()].some((login) => login.clientKey === clientKey)
	) {
		throw new Error("Another provider connection is already in progress");
	}
	if (
		providerLoginProviderReservations.has(providerId) ||
		[...pendingProviderLogins.values()].some((login) => login.providerId === providerId)
	) {
		throw new Error("A connection is already in progress for this provider");
	}
	providerLoginClientReservations.add(clientKey);
	providerLoginProviderReservations.add(providerId);
	let provider: Awaited<ReturnType<GooseClient["listProviders"]>>[number] | undefined;
	try {
		provider = (await client().listProviders([providerId])).find(
			(candidate) => candidate.id === providerId,
		);
	} finally {
		providerLoginClientReservations.delete(clientKey);
		providerLoginProviderReservations.delete(providerId);
	}
	if (!provider) throw new Error(`Unknown provider: ${providerId}`);
	const login: PendingProviderLogin = {
		loginId: randomUUID(),
		providerId,
		clientKey,
		type,
		fields: [],
		fieldIndex: 0,
		values: [],
		abortController: new AbortController(),
		requestInFlight: false,
	};

	if (type === "oauth") {
		if (!provider.configKeys.some((key) => key.oauthFlow)) {
			throw new Error(`${provider.name} does not support native authentication`);
		}
		pendingProviderLogins.set(login.loginId, login);
		armProviderLoginExpiry(login);
		setTimeout(() => void authenticateProviderLogin(login), 0).unref?.();
		const frame: LoginFrame = {
			kind: "progress",
			message: "Waiting for Goose authentication…",
		};
		cacheProviderLoginFrame(login, frame);
		return {
			loginId: login.loginId,
			frame,
		};
	}

	pendingProviderLogins.set(login.loginId, login);
	armProviderLoginExpiry(login);
	let currentFields: Awaited<ReturnType<GooseClient["providerConfig"]>>;
	try {
		currentFields = await client().providerConfig(providerId);
	} catch (error) {
		clearPendingProviderLogin(login);
		throw error;
	}
	const configuredKeys = new Set(
		currentFields.filter((field) => field.isSet).map((field) => field.key),
	);
	login.fields = provider.configKeys.filter(
		(key) => !key.oauthFlow && (key.primary || key.required) && !configuredKeys.has(key.name),
	);
	if (login.fields.length === 0) {
		const hasManualConfiguration = provider.configKeys.some(
			(key) => !key.oauthFlow && (key.primary || key.required),
		);
		if (!hasManualConfiguration) {
			clearPendingProviderLogin(login);
			throw new Error(`${provider.name} does not accept provider configuration fields`);
		}
		setTimeout(() => void completeProviderLogin(login), 0).unref?.();
		const frame: LoginFrame = {
			kind: "progress",
			message: "Checking provider configuration…",
		};
		cacheProviderLoginFrame(login, frame);
		return {
			loginId: login.loginId,
			frame,
		};
	}
	const frame = providerFieldFrame(login.fields[0] as GooseProviderConfigKey);
	cacheProviderLoginFrame(login, frame);
	return {
		loginId: login.loginId,
		frame,
	};
}

export async function replyProviderLogin(
	clientKey: string,
	loginId: string,
	value: string,
): Promise<void> {
	const login = pendingProviderLogins.get(loginId);
	if (!login || login.clientKey !== clientKey || login.type !== "api_key") {
		throw new Error("Unknown or expired provider connection");
	}
	const field = login.fields[login.fieldIndex];
	if (!field) throw new Error("Provider connection is not waiting for input");
	const submitted = field.secret ? value : value.trim();
	const normalized = value.trim() ? submitted : field.defaultValue;
	if (!normalized) throw new Error(`${field.name} cannot be empty`);
	login.values.push({ key: field.name, value: normalized });
	login.fieldIndex += 1;
	const next = login.fields[login.fieldIndex];
	if (next) {
		publishProviderLogin(login, providerFieldFrame(next));
		return;
	}
	await completeProviderLogin(login);
}

export function cancelProviderLogin(clientKey: string, loginId: string): void {
	const login = pendingProviderLogins.get(loginId);
	const snapshot = providerLoginSnapshots.get(clientKey);
	if ((!login || login.clientKey !== clientKey) && snapshot?.push.loginId !== loginId) {
		throw new Error("Unknown or expired provider connection");
	}
	if (login?.clientKey === clientKey) {
		login.abortController.abort(new Error("Provider connection cancelled"));
		if (!login.requestInFlight) clearPendingProviderLogin(login);
	}
	if (snapshot?.push.loginId === loginId) {
		clearTimeout(snapshot.expiresTimer);
		providerLoginSnapshots.delete(clientKey);
	}
}

export async function logoutProvider(providerId: string): Promise<void> {
	if (!providerId || providerId.includes("\0")) throw new Error("Invalid provider identifier");
	await client().deleteProviderConfig(providerId);
}
export async function refreshAvailableModels(): Promise<{
	models: WireModel[];
	complete: boolean;
}> {
	await client().refreshProviderInventory();
	return { models: await listAvailableModels(), complete: true };
}
export async function setModelVisibility(
	provider: string,
	id: string,
	hidden: boolean,
): Promise<WireModel[]> {
	const models = await listAvailableModels();
	if (!models.some((model) => model.provider === provider && model.id === id))
		throw new Error(`Unknown model: ${provider}/${id}`);
	const refs = (getConfig().hiddenModels ?? []).filter(
		(model) => model.provider !== provider || model.id !== id,
	);
	if (hidden) refs.push({ provider, id });
	updateConfig({ hiddenModels: refs });
	return listAvailableModels();
}
export async function setAllModelVisibility(hidden: boolean): Promise<WireModel[]> {
	const models = await listAvailableModels();
	updateConfig({
		hiddenModels: hidden ? models.map(({ provider, id }) => ({ provider, id })) : [],
	});
	return listAvailableModels();
}
export async function getDefaultModel(): Promise<{
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}> {
	const model =
		(await listAvailableModels()).find((candidate) => candidate.available && !candidate.hidden) ??
		null;
	return { model, thinkingLevel: "off" };
}

export const gooseRecipes = () => client();
export const gooseSchedules = () => client();
export type { GooseSchedule };
