import { createReadStream, existsSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	type AgentSessionEvent,
	createAgentSession,
	getAgentDir,
	type NewSessionOptions,
	type SessionInfo,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentSettlement,
	AskUserQuestionResult,
	ImageContent,
	Model,
	ModelReference,
	QueueLane,
	RefreshedModels,
	RemovedQueuedMessage,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionQueueState,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireModel,
} from "@mewa-code/contracts";
import { isTranscriptMessageRole, modelReferenceKey } from "@mewa-code/contracts";
import { assertMountedDirectory } from "../path-admission";
import {
	clearStoredSessionGoal,
	clearStoredSessionGoalsForProject,
	forgetProjectSession,
	forgetProjectSessions,
	loadProjectSessionRecords,
	recordProjectSession,
} from "../persistence";
import { getConfig, updateConfig } from "../settings";
import {
	ANSWERABILITY_ERRORS,
	assessAnswerability,
	buildAnswersMessage,
} from "./ask-user-question";
import { buildResourceLoader, toSkillCommands } from "./extensions";
import { routeSubagentModel } from "./model-routing";
import {
	getPiRuntime,
	getPiRuntimeGeneration,
	type PiRuntimeGeneration,
	refreshCatalogs,
	settledAvailableModels,
} from "./pi-runtime";
import { projectSessionEvent } from "./session-event-projection";
import { repairDanglingToolCalls } from "./session-repair";
import type { SubagentHost } from "./subagent-extension";
import {
	excludedToolsForRole,
	type ModelGroup,
	rolePrompt,
	type SubagentRole,
} from "./subagent-roles";
import type { ChildRunSnapshot, ChildRunStatus, RunChildSessionInput } from "./subagent-types";
import { trashFile } from "./trash";
import { cancelExtUiForSession, createWebUiContext, notifyExtUi } from "./web-ui-context";

interface ChildRelation {
	parentSessionId: string;
	toolCallId: string;
	task: string;
	role: SubagentRole;
	modelGroup: ModelGroup;
	status: ChildRunStatus;
	startedAt: number;
	completedAt?: number | undefined;
	currentTool?: string | undefined;
	finalOutput?: string | undefined;
	outputState?: "present" | "absent" | undefined;
	truncated?: boolean | undefined;
	error?: string | undefined;
}

interface Entry {
	session: AgentSession;
	settingsManager: SettingsManager;
	generation: PiRuntimeGeneration;
	unsubscribe: () => void;
	projectId: string;
	lastSettlement: AgentSettlement | null | undefined;
	child?: ChildRelation;
}

const sessions = new Map<string, Entry>();
const childrenByParent = new Map<string, Set<string>>();

export async function usePiRuntime<T>(
	operation: (
		runtime: PiRuntimeGeneration["runtime"],
		generation: PiRuntimeGeneration,
	) => Promise<T> | T,
): Promise<T> {
	const generation = await getPiRuntimeGeneration();
	return operation(generation.runtime, generation);
}

const deletedSessions = new Map<string, string>();

const deletingSessions = new Map<string, { projectId: string; done: Promise<void> }>();

function isSessionDeleted(sessionId: string, projectId: string): boolean {
	return deletedSessions.get(sessionId) === projectId;
}

export type { SessionEventPayload };

let publish: (payload: SessionEventPayload) => void = () => {};
export function setSessionPublisher(fn: (payload: SessionEventPayload) => void): void {
	publish = fn;
}

let publishDeleted: (payload: SessionDeletedPayload) => void = () => {};
export function setSessionDeletedPublisher(fn: (payload: SessionDeletedPayload) => void): void {
	publishDeleted = fn;
}

let sessionManagerFactory: (cwd: string, options?: NewSessionOptions) => SessionManager = (
	cwd,
	options,
) => SessionManager.create(cwd, undefined, options);
export function setSessionManagerFactory(
	factory: (cwd: string, options?: NewSessionOptions) => SessionManager,
): void {
	sessionManagerFactory = factory;
}

function hasDeletionTombstone(sessionId: string): boolean {
	return deletedSessions.has(sessionId);
}

function mustGetEntry(sessionId: string): Entry {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const entry = sessions.get(sessionId);
	if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	return entry;
}

function mustGet(sessionId: string): AgentSession {
	return mustGetEntry(sessionId).session;
}

export function hasSession(sessionId: string): boolean {
	return sessions.has(sessionId) && !hasDeletionTombstone(sessionId);
}

export function getSessionProjectId(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.projectId;
}

/** Return the immutable Pi runtime generation used to create a live session. */
export function getSessionRuntimeGenerationId(sessionId: string): number | undefined {
	return sessions.get(sessionId)?.generation.id;
}

/** Return the admitted working directory for a live session. */
export function getSessionCwd(sessionId: string): string | undefined {
	return sessions.get(sessionId)?.session.sessionManager.getCwd();
}

/** Return the most recent Pi settlement for a live session, if one exists. */
export function getSessionSettlement(sessionId: string): AgentSettlement | null | undefined {
	return sessions.get(sessionId)?.lastSettlement;
}

export async function reloadSessionResources(sessionId: string): Promise<void> {
	const entry = mustGetEntry(sessionId);
	const session = entry.session;
	if (session.isStreaming) {
		throw new Error(
			"Can't reload skills while the session is streaming — try again after the turn.",
		);
	}
	await session.reload();
}

export function buildSessionSettings(cwd: string): SettingsManager {
	const settings = SettingsManager.create(cwd, undefined, { projectTrusted: false });
	settings.setProjectTrusted(settings.getDefaultProjectTrust() === "always");
	settings.applyOverrides({ images: { autoResize: false } });
	return settings;
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

export function toWireModel(
	model: Model<string>,
	options: { available?: boolean; hidden?: boolean } = {},
): WireModel {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		reasoning: model.reasoning,
		thinkingLevels: getSupportedThinkingLevels(model),
		input: [...model.input],
		cost: {
			input: model.cost.input,
			output: model.cost.output,
			cacheRead: model.cost.cacheRead,
			cacheWrite: model.cost.cacheWrite,
			...(model.cost.tiers ? { tiers: model.cost.tiers.map((tier) => ({ ...tier })) } : {}),
		},
		available: options.available ?? true,
		hidden: options.hidden ?? false,
	};
}

function resolveWireModel(
	runtime: PiRuntimeGeneration["runtime"],
	ref: Pick<WireModel, "provider" | "id">,
): Model<string> {
	const available = settledAvailableModels(runtime);
	const match = available.find((model) => model.provider === ref.provider && model.id === ref.id);
	if (!match) throw new Error(`Unknown or unavailable model: ${ref.provider}/${ref.id}`);
	return match as unknown as Model<string>;
}

const subagentHost: SubagentHost = {
	runChildSession,
};

interface PreparedSessionEntry {
	entry: Entry;
	result: CreateSessionResult;
}

async function prepareSessionEntry(
	session: AgentSession,
	projectId: string,
	generation: PiRuntimeGeneration,
	settingsManager: SettingsManager,
	lastSettlement: AgentSettlement | null | undefined = undefined,
	child?: ChildRelation,
): Promise<PreparedSessionEntry> {
	const { sessionId } = session;
	let terminal: AgentSettlement | null = null;
	const entry: Entry = {
		session,
		settingsManager,
		generation,
		unsubscribe: () => {},
		projectId,
		lastSettlement,
		...(child ? { child } : {}),
	};
	entry.unsubscribe = session.subscribe((event) => {
		if (event.type === "agent_start") {
			entry.lastSettlement = null;
		}
		if (event.type === "agent_end") {
			const assistant = [...event.messages]
				.reverse()
				.find((message) => message.role === "assistant");
			terminal = assistant
				? {
						stopReason: assistant.stopReason,
						...(assistant.errorMessage !== undefined
							? { errorMessage: assistant.errorMessage }
							: {}),
					}
				: null;
		}
		const projected = projectSessionEvent(event, terminal);
		if (event.type === "agent_settled") entry.lastSettlement = terminal;
		if (sessions.get(sessionId) === entry) publish({ sessionId, event: projected });
		if (event.type === "agent_settled") terminal = null;
	});

	try {
		await session.bindExtensions({
			mode: "rpc",
			uiContext: createWebUiContext(sessionId),
			onError: () => notifyExtUi(sessionId, "An extension failed.", "error"),
		});
		if (isSessionDeleted(sessionId, projectId)) throw new Error(`Unknown session: ${sessionId}`);
	} catch (error) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		session.dispose();
		throw error;
	}

	return {
		entry,
		result: {
			sessionId,
			model: session.model ? toWireModel(session.model as unknown as Model<string>) : null,
			thinkingLevel: session.thinkingLevel,
		},
	};
}

async function registerSession(
	session: AgentSession,
	projectId: string,
	generation: PiRuntimeGeneration,
	settingsManager: SettingsManager,
	child?: ChildRelation,
): Promise<CreateSessionResult> {
	const prepared = await prepareSessionEntry(
		session,
		projectId,
		generation,
		settingsManager,
		undefined,
		child,
	);
	sessions.set(session.sessionId, prepared.entry);
	recordProjectSession({
		projectId,
		sessionId: session.sessionId,
		cwd: session.sessionManager.getCwd(),
	});
	if (child) {
		const children = childrenByParent.get(child.parentSessionId) ?? new Set<string>();
		children.add(session.sessionId);
		childrenByParent.set(child.parentSessionId, children);
	}
	return prepared.result;
}

export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(input.cwd);
	const { session } = await createAgentSession({
		cwd: input.cwd,
		modelRuntime: generation.runtime,
		sessionManager: sessionManagerFactory(input.cwd),
		settingsManager,
		resourceLoader: await buildResourceLoader(
			input.cwd,
			settingsManager,
			[],
			input.projectId,
			subagentHost,
		),
		...(input.model ? { model: resolveWireModel(generation.runtime, input.model) } : {}),
		...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
	});
	return registerSession(session, input.projectId, generation, settingsManager);
}

const CHILD_OUTPUT_MAX_BYTES = 32 * 1024;
const CHILD_ERROR_MAX_BYTES = 4 * 1024;

function boundedUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
	const encoded = Buffer.from(value, "utf8");
	if (encoded.byteLength <= maxBytes) return { value, truncated: false };
	const marker = Buffer.from("\n…[truncated]…\n", "utf8");
	const available = Math.max(0, maxBytes - marker.byteLength);
	const headBytes = Math.ceil(available / 2);
	const tailBytes = available - headBytes;
	const fitUtf8 = (chunk: Buffer, limit: number): string => {
		let text = chunk.toString("utf8");
		while (Buffer.byteLength(text, "utf8") > limit) text = [...text].slice(0, -1).join("");
		return text;
	};
	const head = fitUtf8(encoded.subarray(0, headBytes), headBytes);
	const tail =
		tailBytes > 0 ? fitUtf8(encoded.subarray(encoded.byteLength - tailBytes), tailBytes) : "";
	return { value: `${head}${marker.toString("utf8")}${tail}`, truncated: true };
}

function safeChildError(error: unknown): string {
	return boundedUtf8(error instanceof Error ? error.message : String(error), CHILD_ERROR_MAX_BYTES)
		.value;
}

function assistantOutput(session: AgentSession): string | undefined {
	for (const message of [...session.messages].reverse()) {
		if (message.role !== "assistant") continue;
		const content = Reflect.get(message, "content");
		if (!Array.isArray(content)) continue;
		const text = content
			.map((part) => {
				if (typeof part === "string") return part;
				if (typeof part === "object" && part !== null && Reflect.get(part, "type") === "text") {
					const value = Reflect.get(part, "text");
					return typeof value === "string" ? value : "";
				}
				return "";
			})
			.join("");
		if (text.length > 0) return text;
	}
	return undefined;
}

function childSnapshot(parentSessionId: string, entry: Entry): ChildRunSnapshot {
	if (!entry.child) throw new Error(`Session ${entry.session.sessionId} is not a child session`);
	const model = entry.session.model
		? toWireModel(entry.session.model as unknown as Model<string>)
		: null;
	return {
		parentSessionId,
		childSessionId: entry.session.sessionId,
		role: entry.child.role,
		task: entry.child.task,
		status: entry.child.status,
		model,
		thinkingLevel: entry.session.thinkingLevel,
		modelGroup: entry.child.modelGroup,
		durationMs: (entry.child.completedAt ?? Date.now()) - entry.child.startedAt,
		...(entry.child.completedAt ? { usage: getSessionStats(entry.session.sessionId) } : {}),
		...(entry.child.currentTool ? { currentTool: entry.child.currentTool } : {}),
		...(entry.child.finalOutput !== undefined ? { finalOutput: entry.child.finalOutput } : {}),
		...(entry.child.outputState ? { outputState: entry.child.outputState } : {}),
		...(entry.child.truncated ? { truncated: true } : {}),
		...(entry.child.error ? { error: entry.child.error } : {}),
	};
}

function removeActiveChildIndex(entry: Entry): void {
	const child = entry.child;
	if (!child) return;
	const children = childrenByParent.get(child.parentSessionId);
	if (!children) return;
	children.delete(entry.session.sessionId);
	if (children.size === 0) childrenByParent.delete(child.parentSessionId);
}

function childSettlementStatus(entry: Entry): "completed" | "failed" | "cancelled" {
	if (entry.child?.status === "cancelled") return "cancelled";
	const settlement = entry.lastSettlement;
	if (settlement?.stopReason === "aborted") return "cancelled";
	if (settlement?.stopReason === "error" || settlement?.errorMessage) return "failed";
	if (entry.session.state.errorMessage) return "failed";
	return "completed";
}

/**
 * Run one persistent child through the same Pi generation and resource
 * boundaries as its parent. This is the only manager entry point exposed to
 * the built-in subagent extension.
 */
export async function runChildSession(
	input: RunChildSessionInput,
	signal: AbortSignal | undefined,
	onProgress?: (snapshot: ChildRunSnapshot) => void,
): Promise<ChildRunSnapshot> {
	const parent = mustGetEntry(input.parentSessionId);
	if (parent.child?.status === "cancelled")
		throw new Error(`Parent session is cancelling: ${input.parentSessionId}`);
	if (signal?.aborted) throw new Error("Subagent was cancelled before launch.");

	const parentCwd = parent.session.sessionManager.getCwd();
	const cwd = assertMountedDirectory(parentCwd, "Subagent workspace");
	const routed = routeSubagentModel(
		settledAvailableModels(parent.generation.runtime).map((model) => toWireModel(model)),
		input.role,
		input.modelGroup,
		input.thinkingLevel,
	);
	const selectedModel = resolveWireModel(parent.generation.runtime, routed.model);
	const thinkingLevel = clampThinkingLevel(selectedModel, routed.thinkingLevel);
	const settingsManager = buildSessionSettings(cwd);
	const relation: ChildRelation = {
		parentSessionId: input.parentSessionId,
		toolCallId: input.toolCallId,
		task: input.task,
		role: input.role,
		modelGroup: routed.requestedGroup,
		status: "starting",
		startedAt: Date.now(),
	};
	const parentSession = parent.session.sessionFile;
	const childSessionManager = sessionManagerFactory(
		cwd,
		parentSession ? { parentSession } : undefined,
	);
	childSessionManager.appendCustomEntry("mewa-subagent-relation", {
		version: 1,
		parentSessionId: relation.parentSessionId,
		toolCallId: relation.toolCallId,
		role: relation.role,
		modelGroup: relation.modelGroup,
		task: relation.task,
	});

	const resourceLoader = await buildResourceLoader(
		cwd,
		settingsManager,
		[],
		parent.projectId,
		subagentHost,
	);
	const revalidatedCwd = assertMountedDirectory(parentCwd, "Subagent workspace");
	if (revalidatedCwd !== cwd) {
		throw new Error(`Subagent workspace changed while preparing child: ${parentCwd}`);
	}

	const { session } = await createAgentSession({
		cwd,
		modelRuntime: parent.generation.runtime,
		sessionManager: childSessionManager,
		settingsManager,
		resourceLoader,
		...(selectedModel ? { model: selectedModel } : {}),
		thinkingLevel,
		excludeTools: excludedToolsForRole(input.role),
	});

	if (
		sessions.get(input.parentSessionId) !== parent ||
		hasDeletionTombstone(input.parentSessionId)
	) {
		session.dispose();
		throw new Error(`Parent session is no longer available: ${input.parentSessionId}`);
	}

	const created = await registerSession(
		session,
		parent.projectId,
		parent.generation,
		settingsManager,
		relation,
	);
	const child = sessions.get(created.sessionId);
	if (!child) {
		session.dispose();
		throw new Error(`Child session ${created.sessionId} failed to register.`);
	}
	if (
		sessions.get(input.parentSessionId) !== parent ||
		hasDeletionTombstone(input.parentSessionId)
	) {
		disposeSession(created.sessionId);
		throw new Error(`Parent session is no longer available: ${input.parentSessionId}`);
	}

	let terminal = false;
	let unsubscribeRun = () => {};
	let abortPromise: Promise<void> | undefined;
	const settle = (status: "completed" | "failed" | "cancelled", error?: unknown): void => {
		if (terminal) return;
		terminal = true;
		if (!child.child) return;
		child.child.status = status;
		child.child.completedAt = Date.now();
		child.child.currentTool = undefined;
		if (status === "completed") {
			const output = assistantOutput(child.session);
			if (output === undefined) {
				child.child.outputState = "absent";
			} else {
				const bounded = boundedUtf8(output, CHILD_OUTPUT_MAX_BYTES);
				child.child.finalOutput = bounded.value;
				child.child.outputState = "present";
				child.child.truncated = bounded.truncated;
			}
		}
		if (status === "failed")
			child.child.error = safeChildError(
				error ?? child.session.state.errorMessage ?? "unknown error",
			);
		child.session.sessionManager.appendCustomEntry("mewa-subagent-settlement", {
			version: 1,
			status,
			completedAt: child.child.completedAt,
			outputState: child.child.outputState,
			truncated: child.child.truncated === true,
			error: child.child.error,
		});
		removeActiveChildIndex(child);
		onProgress?.(childSnapshot(input.parentSessionId, child));
	};

	const onAbort = (): void => {
		if (terminal) return;
		if (child.child) {
			child.child.status = "cancelled";
			child.child.currentTool = undefined;
		}
		onProgress?.(childSnapshot(input.parentSessionId, child));
		abortPromise ??= cancelChildTree(child.session.sessionId)
			.then(() => child.session.abort())
			.catch(() => {});
	};
	const onEvent = (event: AgentSessionEvent): void => {
		const relation = child.child;
		switch (event.type) {
			case "agent_start":
				if (relation && relation.status !== "cancelled") relation.status = "running";
				onProgress?.(childSnapshot(input.parentSessionId, child));
				break;
			case "tool_execution_start":
				if (relation && relation.status !== "cancelled") {
					relation.status = "running";
					relation.currentTool = event.toolName;
				}
				onProgress?.(childSnapshot(input.parentSessionId, child));
				break;
			case "tool_execution_end":
				if (child.child) child.child.currentTool = undefined;
				onProgress?.(childSnapshot(input.parentSessionId, child));
				break;
			case "agent_settled":
				settle(childSettlementStatus(child));
				break;
		}
	};
	// AgentSession's public subscribe signature is used rather than reaching
	// into the extension runner, keeping child progress independent of Pi's
	// internal tool result payloads.
	unsubscribeRun = child.session.subscribe(onEvent);
	onProgress?.(childSnapshot(input.parentSessionId, child));
	if (signal) signal.addEventListener("abort", onAbort, { once: true });

	try {
		if (signal?.aborted || child.child?.status === "cancelled") {
			onAbort();
			if (abortPromise) await abortPromise;
		} else {
			await child.session.prompt(rolePrompt(input.role, input.task), {
				expandPromptTemplates: false,
				source: "extension",
			});
			await child.session.waitForIdle();
		}
		if (signal?.aborted || child.child?.status === "cancelled") {
			settle("cancelled");
		} else if (!terminal) {
			settle(childSettlementStatus(child));
		}
	} catch (error) {
		if (signal?.aborted || child.child?.status === "cancelled") settle("cancelled");
		else settle("failed", error);
	} finally {
		if (signal) signal.removeEventListener("abort", onAbort);
		unsubscribeRun();
		if (abortPromise) await abortPromise;
	}
	return childSnapshot(input.parentSessionId, child);
}

function summaryOf(sessionId: string, entry: Entry): SessionSummary {
	const { session } = entry;
	return {
		sessionId,
		projectId: entry.projectId,
		cwd: session.sessionManager.getCwd(),
		title: session.sessionName ?? "Chat",
		model: session.model ? toWireModel(session.model as unknown as Model<string>) : null,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		messageCount: session.messages.length,
		updatedAt: Date.now(),
		live: true,
		...(entry.lastSettlement !== undefined ? { lastSettlement: entry.lastSettlement } : {}),
		...(session.pendingMessageCount > 0 ? { queue: queueStateOf(session) } : {}),
	};
}

interface SessionFileIdentity {
	id: string;
	cwd: string;
}

type ScannedSessionFile =
	| { path: string; ok: true; identity: SessionFileIdentity }
	| { path: string; ok: false; error: Error };

function defaultSessionDirectory(cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolve(getAgentDir()), "sessions", safePath);
}

function hasErrorCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && Reflect.get(error, "code") === code;
}

async function readSessionFileIdentity(path: string): Promise<SessionFileIdentity> {
	const input = createReadStream(path, { encoding: "utf8" });
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
	try {
		for await (const line of lines) {
			if (!line.trim()) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line);
			} catch {
				continue;
			}
			if (typeof entry !== "object" || entry === null) {
				throw new Error("first parsed entry is not an object");
			}
			const id = Reflect.get(entry, "id");
			if (Reflect.get(entry, "type") !== "session" || typeof id !== "string") {
				throw new Error("first parsed entry is not a session header");
			}
			const headerCwd = Reflect.get(entry, "cwd");
			return { id, cwd: typeof headerCwd === "string" ? headerCwd : "" };
		}
		throw new Error("session header is missing");
	} catch (error) {
		throw new Error(`Session transcript is unreadable or malformed: ${path}`, { cause: error });
	} finally {
		lines.close();
		input.destroy();
	}
}

async function scanSessionFiles(
	cwd: string,
	excludedPaths: ReadonlySet<string> = new Set(),
): Promise<ScannedSessionFile[]> {
	const dir = defaultSessionDirectory(cwd);
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw new Error(`Session directory is unreadable: ${dir}`, { cause: error });
	}
	const scanned: ScannedSessionFile[] = [];
	for (const name of names) {
		if (!name.endsWith(".jsonl")) continue;
		const path = join(dir, name);
		if (excludedPaths.has(resolve(path))) continue;
		try {
			scanned.push({ path, ok: true, identity: await readSessionFileIdentity(path) });
		} catch (error) {
			scanned.push({
				path,
				ok: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		}
	}
	return scanned;
}

function sessionFileMayContainId(path: string, sessionId: string): boolean {
	const name = basename(path);
	return name === `${sessionId}.jsonl` || name.endsWith(`_${sessionId}.jsonl`);
}

async function findSessionInfoStrict(
	cwd: string,
	sessionId: string,
): Promise<SessionInfo | undefined> {
	const scanned = await scanSessionFiles(cwd);
	const targetFiles = scanned.filter((file) =>
		file.ok
			? file.identity.id === sessionId && file.identity.cwd === cwd
			: sessionFileMayContainId(file.path, sessionId),
	);
	const infos = await SessionManager.list(cwd);
	const listedByPath = new Map(infos.map((info) => [resolve(info.path), info]));
	for (const file of targetFiles) {
		if (!file.ok) throw file.error;
		const listed = listedByPath.get(resolve(file.path));
		if (!listed || listed.id !== file.identity.id || listed.cwd !== file.identity.cwd) {
			throw new Error(`Session transcript could not be listed: ${file.path}`);
		}
		return listed;
	}

	const listed = infos.find((info) => info.id === sessionId && info.cwd === cwd);
	if (!listed) return undefined;
	const scannedFile = scanned.find((file) => resolve(file.path) === resolve(listed.path));
	if (!scannedFile?.ok) {
		throw new Error(`Session transcript could not be listed: ${listed.path}`);
	}
	if (scannedFile.identity.id !== listed.id || scannedFile.identity.cwd !== listed.cwd)
		throw new Error(`Session transcript could not be listed: ${listed.path}`);
	return listed;
}

async function listSessionsInternal(projectId: string): Promise<SessionSummary[]> {
	const live: SessionSummary[] = [];
	const liveIds = new Set<string>();
	for (const [sessionId, entry] of sessions) {
		if (entry.projectId !== projectId || isSessionDeleted(sessionId, projectId)) continue;
		live.push(summaryOf(sessionId, entry));
		liveIds.add(sessionId);
	}
	const records = loadProjectSessionRecords().filter(
		(record) => record.projectId === projectId && !liveIds.has(record.sessionId),
	);
	const disk = (
		await Promise.all(
			records.map(async (record): Promise<SessionSummary | null> => {
				if (isSessionDeleted(record.sessionId, projectId)) return null;
				const info = await findSessionInfoStrict(record.cwd, record.sessionId);
				if (!info) return null;
				return {
					sessionId: info.id,
					projectId,
					cwd: info.cwd,
					title: info.name ?? "Chat",
					model: null,
					thinkingLevel: "medium" as ThinkingLevel,
					isStreaming: false,
					messageCount: info.messageCount,
					updatedAt: info.modified.getTime(),
					live: false,
				};
			}),
		)
	).filter((summary): summary is SessionSummary => summary !== null);
	return [...live, ...disk];
}

export function listSessions(projectId: string): Promise<SessionSummary[]> {
	return listSessionsInternal(projectId);
}

const attaching = new Map<string, Promise<void>>();

function attachDiskSession(sessionId: string, projectId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, projectId))
		return Promise.reject(new Error(`Unknown session: ${sessionId}`));
	if (sessions.has(sessionId)) return Promise.resolve();
	let pending = attaching.get(sessionId);
	if (!pending) {
		pending = openDiskSession(sessionId, projectId, cwd).finally(() => attaching.delete(sessionId));
		attaching.set(sessionId, pending);
	}
	return pending;
}

function persistedSessionModelRef(model: unknown): { provider: string; id: string } | undefined {
	if (typeof model !== "object" || model === null) return undefined;
	const provider = Reflect.get(model, "provider");
	const id = Reflect.get(model, "modelId");
	if (provider === undefined && id === undefined) return undefined;
	if (typeof provider !== "string" || !provider || typeof id !== "string" || !id) {
		throw new Error("The chat's saved model is unavailable.");
	}
	return { provider, id };
}

async function openDiskSession(sessionId: string, projectId: string, cwd: string): Promise<void> {
	if (isSessionDeleted(sessionId, projectId)) throw new Error(`Unknown session: ${sessionId}`);
	const info = await findSessionInfoStrict(cwd, sessionId);
	if (!info) throw new Error(`Unknown session: ${sessionId}`);
	if (sessions.has(sessionId)) return;
	const generation = await getPiRuntimeGeneration();
	const settingsManager = buildSessionSettings(cwd);
	const sessionManager = SessionManager.open(info.path);
	const persistedModel = persistedSessionModelRef(sessionManager.buildSessionContext().model);
	let exactModel: Model<string> | undefined;
	if (persistedModel) {
		try {
			exactModel = resolveWireModel(generation.runtime, persistedModel);
		} catch {
			throw new Error("The chat's saved model is unavailable.");
		}
	}
	repairDanglingToolCalls(sessionManager);
	const { session } = await createAgentSession({
		cwd,
		modelRuntime: generation.runtime,
		sessionManager,
		settingsManager,
		resourceLoader: await buildResourceLoader(cwd, settingsManager, [], projectId, subagentHost),
		...(exactModel ? { model: exactModel } : {}),
	});
	if (sessions.has(sessionId)) {
		session.dispose();
		return;
	}
	await registerSession(session, projectId, generation, settingsManager);
}

async function ensureSessionAttachedInternal(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<boolean> {
	if (isSessionDeleted(sessionId, projectId)) return false;
	const live = sessions.get(sessionId);
	if (live) {
		if (live.projectId !== projectId) throw new Error(`Unknown session: ${sessionId}`);
		if (live.session.sessionManager.getCwd() !== cwd)
			throw new Error(`Unknown session: ${sessionId}`);
		return true;
	}
	const known = await findSessionInfoStrict(cwd, sessionId);
	if (!known) return false;
	await attachDiskSession(sessionId, projectId, cwd);
	if (!sessions.has(sessionId))
		throw new Error(`Session ${sessionId} was re-opened but did not register.`);
	return true;
}

export function ensureSessionAttached(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<boolean> {
	return ensureSessionAttachedInternal(sessionId, projectId, cwd);
}

async function getSessionMessagesInternal(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	if (isSessionDeleted(sessionId, projectId)) throw new Error(`Unknown session: ${sessionId}`);
	let entry = sessions.get(sessionId);
	if (entry && entry.projectId !== projectId) throw new Error(`Unknown session: ${sessionId}`);
	if (entry && entry.session.sessionManager.getCwd() !== cwd)
		throw new Error(`Unknown session: ${sessionId}`);
	if (!entry) {
		await attachDiskSession(sessionId, projectId, cwd);
		if (isSessionDeleted(sessionId, projectId)) throw new Error(`Unknown session: ${sessionId}`);
		entry = sessions.get(sessionId);
		if (!entry) throw new Error(`Unknown session: ${sessionId}`);
	}
	const messages = entry.session.messages.filter((m) =>
		isTranscriptMessageRole(m.role),
	) as TranscriptMessage[];
	return { summary: summaryOf(sessionId, entry), messages };
}

export function getSessionMessages(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<{ summary: SessionSummary; messages: TranscriptMessage[] }> {
	return getSessionMessagesInternal(sessionId, projectId, cwd);
}

export async function answerQuestion(
	sessionId: string,
	toolCallId: string,
	result: AskUserQuestionResult,
): Promise<void> {
	const session = mustGet(sessionId);
	const verdict = assessAnswerability(session.messages, toolCallId);
	if (!verdict.ok) throw new Error(`${ANSWERABILITY_ERRORS[verdict.reason]}: ${toolCallId}`);
	await session.sendCustomMessage(buildAnswersMessage(toolCallId, verdict.args, result), {
		triggerTurn: true,
	});
}

export async function promptSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.steer(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

export function steerSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	return mustGet(sessionId).steer(text, images);
}

export async function followUpSession(
	sessionId: string,
	text: string,
	images?: ImageContent[],
): Promise<void> {
	const session = mustGet(sessionId);
	if (session.isStreaming) {
		await session.followUp(text, images);
		return;
	}
	await session.prompt(text, images ? { images } : undefined);
}

export async function compactSession(sessionId: string, instructions?: string): Promise<void> {
	await mustGet(sessionId).compact(instructions);
}

function queueStateOf(session: AgentSession): SessionQueueState {
	return {
		steering: [...session.getSteeringMessages()],
		followUp: [...session.getFollowUpMessages()],
	};
}

export function clearQueueSession(sessionId: string): SessionQueueState {
	return mustGet(sessionId).clearQueue();
}

export async function removeQueuedSession(
	sessionId: string,
	kind: QueueLane,
	index: number,
): Promise<RemovedQueuedMessage> {
	const session = mustGet(sessionId);
	const drained = session.clearQueue();
	const lane = [...drained[kind]];
	const removed = index >= 0 && index < lane.length ? (lane.splice(index, 1)[0] ?? null) : null;
	const keep = { ...drained, [kind]: lane };
	for (const text of keep.steering) await session.steer(text);
	for (const text of keep.followUp) await session.followUp(text);
	if (!session.isStreaming && session.pendingMessageCount > 0) {
		const parked = session.clearQueue();
		for (const text of [...parked.steering, ...parked.followUp]) {
			await followUpSession(sessionId, text);
		}
	}
	return { removed, queue: queueStateOf(session) };
}

async function cancelChildTree(
	parentSessionId: string,
	visited = new Set<string>(),
): Promise<void> {
	const childIds = [...(childrenByParent.get(parentSessionId) ?? [])];
	for (const childSessionId of childIds) {
		if (visited.has(childSessionId)) continue;
		visited.add(childSessionId);
		await cancelChildTree(childSessionId, visited);
		const entry = sessions.get(childSessionId);
		if (!entry?.child || entry.child.status === "completed" || entry.child.status === "failed")
			continue;
		entry.child.status = "cancelled";
		entry.child.currentTool = undefined;
		await entry.session.abort().catch(() => {});
		if (!entry.session.isStreaming) removeActiveChildIndex(entry);
	}
}

export async function abortSession(sessionId: string): Promise<void> {
	await cancelChildTree(sessionId);
	await mustGet(sessionId).abort();
}

export async function setSessionModel(sessionId: string, model: WireModel): Promise<void> {
	const entry = mustGetEntry(sessionId);
	await entry.session.setModel(resolveWireModel(entry.generation.runtime, model));
}

export function setSessionThinkingLevel(sessionId: string, level: ThinkingLevel): void {
	mustGet(sessionId).setThinkingLevel(level);
}

export function getSessionStats(sessionId: string): SessionStats {
	const session = mustGet(sessionId);
	const stats = session.getSessionStats();
	const contextUsage = stats.contextUsage ?? session.getContextUsage();
	return {
		sessionId: stats.sessionId,
		totalMessages: stats.totalMessages,
		tokens: {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			cacheWrite: stats.tokens.cacheWrite,
			total: stats.tokens.total,
		},
		cost: stats.cost,
		...(contextUsage ? { contextUsage } : {}),
	};
}

export function getSessionCommands(sessionId: string): SlashCommandInfo[] {
	const session = mustGet(sessionId);
	const extension = session.extensionRunner.getRegisteredCommands().map((command) => ({
		name: command.invocationName,
		source: "extension" as const,
		sourceInfo: command.sourceInfo,
		...(command.description !== undefined ? { description: command.description } : {}),
	}));
	const prompt = session.promptTemplates.map((template) => ({
		name: template.name,
		description: template.description,
		source: "prompt" as const,
		sourceInfo: template.sourceInfo,
	}));
	const skill = toSkillCommands(session.resourceLoader.getSkills().skills);
	return [...extension, ...prompt, ...skill];
}

export async function listAvailableModels(): Promise<WireModel[]> {
	const runtime = await getPiRuntime();
	void refreshCatalogs(runtime);
	return readModelCatalog(runtime);
}

export async function refreshAvailableModels(force = false): Promise<RefreshedModels> {
	const runtime = await getPiRuntime();
	const { completed } = await refreshCatalogs(runtime, { force });
	return { models: readModelCatalog(runtime), complete: completed };
}

export function readModelCatalog(
	runtime: Pick<Awaited<ReturnType<typeof getPiRuntime>>, "getModels" | "getAvailableSnapshot">,
): WireModel[] {
	const available = new Set(
		settledAvailableModels(runtime).map((model) =>
			modelReferenceKey({ provider: model.provider, id: model.id }),
		),
	);
	const hidden = new Set((getConfig().hiddenModels ?? []).map(modelReferenceKey));
	return runtime
		.getModels()
		.map((model) => {
			const key = modelReferenceKey({ provider: model.provider, id: model.id });
			return toWireModel(model as unknown as Model<string>, {
				available: available.has(key),
				hidden: hidden.has(key),
			});
		})
		.sort(
			(a, b) =>
				a.provider.localeCompare(b.provider) ||
				a.name.localeCompare(b.name) ||
				a.id.localeCompare(b.id),
		);
}

function modelReference(provider: string, id: string): ModelReference {
	if (!provider || !id || provider.includes("\0") || id.includes("\0")) {
		throw new Error("Invalid model reference");
	}
	return { provider, id };
}

export async function setModelVisibility(
	provider: string,
	id: string,
	hidden: boolean,
): Promise<WireModel[]> {
	const runtime = await getPiRuntime();
	const ref = modelReference(provider, id);
	if (!runtime.getModel(provider, id)) throw new Error(`Unknown model: ${provider}/${id}`);
	const key = modelReferenceKey(ref);
	const current = getConfig().hiddenModels ?? [];
	const next = current.filter((candidate) => modelReferenceKey(candidate) !== key);
	if (hidden) next.push(ref);
	updateConfig({ hiddenModels: next });
	return readModelCatalog(runtime);
}

export async function setAllModelVisibility(hidden: boolean): Promise<WireModel[]> {
	const runtime = await getPiRuntime();
	updateConfig({
		hiddenModels: hidden
			? runtime.getModels().map((model) => ({ provider: model.provider, id: model.id }))
			: [],
	});
	return readModelCatalog(runtime);
}

export interface DefaultModelResult {
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
}

export async function clampThinkingForModel(
	ref: Pick<WireModel, "provider" | "id">,
	level: ThinkingLevel,
): Promise<ThinkingLevel> {
	const generation = await getPiRuntimeGeneration();
	return clampThinkingLevel(resolveWireModel(generation.runtime, ref), level);
}

export async function getDefaultModel(): Promise<DefaultModelResult> {
	const available = settledAvailableModels(await getPiRuntime());
	const settings = SettingsManager.create(process.cwd());
	const provider = settings.getDefaultProvider();
	const modelId = settings.getDefaultModel();
	const pinned =
		provider && modelId
			? available.find((model) => model.provider === provider && model.id === modelId)
			: undefined;
	const resolved = (pinned ?? available[0] ?? null) as Model<string> | null;
	const saved = settings.getDefaultThinkingLevel() ?? "medium";
	const thinkingLevel = resolved ? clampThinkingLevel(resolved, saved) : saved;
	return { model: resolved ? toWireModel(resolved) : null, thinkingLevel };
}

export function isSessionStreaming(sessionId: string): boolean {
	return mustGet(sessionId).isStreaming;
}

function disposeSession(sessionId: string): void {
	const entry = sessions.get(sessionId);
	if (!entry) return;
	cancelExtUiForSession(sessionId);
	entry.unsubscribe();
	entry.session.dispose();
	removeActiveChildIndex(entry);
	sessions.delete(sessionId);
}

export function removeSession(sessionId: string): Promise<void> {
	if (hasDeletionTombstone(sessionId)) throw new Error(`Unknown session: ${sessionId}`);
	const entry = sessions.get(sessionId);
	if (!entry) return Promise.resolve();
	if ((childrenByParent.get(sessionId)?.size ?? 0) === 0 && !entry.session.isStreaming) {
		disposeSession(sessionId);
		return Promise.resolve();
	}
	return cancelChildTree(sessionId)
		.then(() => (entry.session.isStreaming ? entry.session.abort() : undefined))
		.then(() => disposeSession(sessionId));
}

export function disposeAllSessions(): void {
	const entries = [...sessions.entries()];
	const visited = new Set<string>();
	for (const [sessionId] of entries) void cancelChildTree(sessionId, visited);
	for (const [sessionId, entry] of sessions) {
		cancelExtUiForSession(sessionId);
		entry.unsubscribe();
		if (entry.session.isStreaming) void entry.session.abort().catch(() => {});
		entry.session.dispose();
	}
	sessions.clear();
	childrenByParent.clear();
	deletedSessions.clear();
}

export async function settleSessionsForShutdown(timeoutMs = 2000): Promise<void> {
	const visited = new Set<string>();
	for (const sessionId of sessions.keys()) await cancelChildTree(sessionId, visited);
	const streaming = [...sessions.values()].filter((entry) => entry.session.isStreaming);
	if (streaming.length === 0) return;
	await Promise.race([
		Promise.allSettled(streaming.map((entry) => entry.session.abort())),
		new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
	]);
}

async function removeProjectSessionsInternal(projectId: string, cwd?: string): Promise<void> {
	const ids = [...sessions]
		.filter(([, entry]) => entry.projectId === projectId)
		.map(([sessionId]) => sessionId);
	const visited = new Set<string>();
	for (const sessionId of ids) await cancelChildTree(sessionId, visited);
	for (const sessionId of ids) {
		const entry = sessions.get(sessionId);
		if (!entry) continue;
		if (entry.session.isStreaming) await entry.session.abort().catch(() => {});
		disposeSession(sessionId);
	}
	if (cwd) await purgeDiskSessions(cwd);
	clearStoredSessionGoalsForProject(projectId);
	forgetProjectSessions(projectId);
}

export function removeProjectSessions(projectId: string, cwd?: string): Promise<void> {
	return removeProjectSessionsInternal(projectId, cwd);
}

async function purgeDiskSessions(cwd: string): Promise<void> {
	let infos: Awaited<ReturnType<typeof SessionManager.list>>;
	try {
		infos = await SessionManager.list(cwd);
	} catch (error) {
		throw new Error(`Session directory is unreadable: ${cwd}`, { cause: error });
	}
	for (const info of infos) {
		if (info.cwd === cwd) rmSync(info.path, { force: true });
	}
}

export function deleteSession(sessionId: string, projectId: string, cwd: string): Promise<void> {
	const inFlight = deletingSessions.get(sessionId);
	if (inFlight) {
		if (inFlight.projectId !== projectId)
			return Promise.reject(new Error(`Unknown session: ${sessionId}`));
		return inFlight.done;
	}

	const transaction = runDeleteTransaction(sessionId, projectId, cwd);
	const done = transaction.then(
		() => {
			deletingSessions.delete(sessionId);
		},
		(error: unknown) => {
			deletingSessions.delete(sessionId);
			throw error;
		},
	);
	deletingSessions.set(sessionId, { projectId, done });
	return done;
}

async function runDeleteTransaction(
	sessionId: string,
	projectId: string,
	cwd: string,
): Promise<void> {
	const installedTombstone = !deletedSessions.has(sessionId);
	deletedSessions.set(sessionId, projectId);
	let liveEntry: Entry | undefined;
	try {
		await attaching.get(sessionId)?.catch(() => {});
		const entry = sessions.get(sessionId);
		if (entry && entry.projectId !== projectId) {
			throw new Error(`Unknown session: ${sessionId}`);
		}
		let path: string | undefined;
		if (entry) {
			liveEntry = entry;
			await cancelChildTree(sessionId);
			if (entry.session.isStreaming) await entry.session.abort();
			const manager = entry.session.sessionManager;
			if (manager.getSessionId() !== sessionId || manager.getCwd() !== cwd) {
				throw new Error(`Session transcript scope mismatch: ${sessionId}`);
			}
			path = manager.getSessionFile();
			if (manager.isPersisted() && !path) {
				throw new Error(`Persisted session has no transcript path: ${sessionId}`);
			}
		} else {
			const info = await findSessionInfoStrict(cwd, sessionId);
			if (!info) throw new Error(`Unknown session: ${sessionId}`);
			path = info.path;
		}
		if (path && existsSync(path)) await trashFile(path);
	} catch (error) {
		if (installedTombstone) deletedSessions.delete(sessionId);
		throw error;
	}
	clearStoredSessionGoal(projectId, sessionId);
	forgetProjectSession(projectId, sessionId);
	if (liveEntry && sessions.get(sessionId) === liveEntry) disposeSession(sessionId);
	publishDeleted({ projectId, sessionId });
}
