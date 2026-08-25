import { isAbsolute, relative } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { PiEvent, ToolResultMessage, TranscriptMessage } from "@mewa-code/contracts";
import {
	ACCEPTED_IMAGE_TYPES,
	IMAGE_MAX_BASE64_BYTES,
	type ImageContent as PiImageContent,
	type TextContent as PiTextContent,
	type ToolCall as PiToolCall,
	REQUEST_IMAGE_BASE64_BUDGET,
} from "@mewa-code/contracts";
import { resolveShellEnv } from "@mewa-code/shared/shellEnv";
import {
	abortSession,
	cancelExtUiForSession,
	createSession,
	disposeAllSessions,
	getSessionCwd,
	getSessionMessages,
	getSessionProjectId,
	getSessionSettlement,
	isSessionStreaming,
	promptSession,
	setSessionDeletedPublisher,
	setSessionPublisher,
	settleSessionsForShutdown,
} from "../agent";
import { getPiRuntime } from "../agent/pi-runtime";
import { setExtUiPublisher } from "../agent/web-ui-context";
import { installCrashLog } from "../host/crash-log";
import { assertMountedDirectory } from "../path-admission";
import { addProjectRoot, assertProjectCwd, getProjects, openProject } from "../projects";

/** Maximum number of ACP content blocks accepted in one prompt. */
export const ACP_MAX_PROMPT_BLOCKS = 128;
/** Maximum UTF-8 bytes of text and resource references accepted in one prompt. */
export const ACP_MAX_PROMPT_TEXT_BYTES = 4 * 1024 * 1024;
/** Maximum length of a path carried by ACP. */
export const ACP_MAX_PATH_LENGTH = 4_096;
/** Maximum length of a resource URI carried by ACP. */
export const ACP_MAX_RESOURCE_URI_LENGTH = 2_048;
/** Maximum length of a resource display name carried by ACP. */
export const ACP_MAX_RESOURCE_NAME_LENGTH = 256;
/** Maximum number of bytes retained for one replayed text block. */
export const ACP_MAX_REPLAY_TEXT_BYTES = 4 * 1024 * 1024;

const ACP_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type AcpUpdate = acp.SessionUpdate;
type AcpContentBlock = acp.ContentBlock;
type AcpImageBlock = Extract<AcpContentBlock, { type: "image" }>;

export interface AcpPromptInput {
	text: string;
	images?: PiImageContent[];
}

interface SessionOwner {
	projectId: string;
	cwd: string;
}

type ProjectAdmission = SessionOwner;

/** Narrow seam for ACP lifecycle tests. Defaults are the live process-global implementations. */
export interface AcpConnectorDependencies {
	abortSession: typeof abortSession;
	cancelExtUiForSession: typeof cancelExtUiForSession;
	createSession: typeof createSession;
	disposeAllSessions: typeof disposeAllSessions;
	addProjectRoot: typeof addProjectRoot;
	assertProjectCwd: typeof assertProjectCwd;
	getProjects: typeof getProjects;
	getSessionCwd: typeof getSessionCwd;
	getSessionMessages: typeof getSessionMessages;
	getSessionSettlement: typeof getSessionSettlement;
	getSessionProjectId: typeof getSessionProjectId;
	isSessionStreaming: typeof isSessionStreaming;
	openProject: typeof openProject;
	promptSession: typeof promptSession;
	assertMountedDirectory: typeof assertMountedDirectory;
	setExtUiPublisher: typeof setExtUiPublisher;
	setSessionDeletedPublisher: typeof setSessionDeletedPublisher;
	setSessionPublisher: typeof setSessionPublisher;
	settleSessionsForShutdown: typeof settleSessionsForShutdown;
}

const DEFAULT_ACP_CONNECTOR_DEPENDENCIES: AcpConnectorDependencies = {
	abortSession,
	cancelExtUiForSession,
	createSession,
	disposeAllSessions,
	addProjectRoot,
	assertProjectCwd,
	getProjects,
	getSessionCwd,
	getSessionMessages,
	getSessionSettlement,
	getSessionProjectId,
	isSessionStreaming,
	openProject,
	promptSession,
	assertMountedDirectory,
	setExtUiPublisher,
	setSessionDeletedPublisher,
	setSessionPublisher,
	settleSessionsForShutdown,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidParams(message: string): acp.RequestError {
	return acp.RequestError.invalidParams(undefined, message);
}

function internalError(message: string): acp.RequestError {
	return acp.RequestError.internalError(undefined, message);
}

function boundedString(value: unknown, field: string, maxBytes: number): string {
	if (typeof value !== "string" || value.includes("\0")) {
		throw invalidParams(`${field} must be a NUL-free string`);
	}
	if (new TextEncoder().encode(value).byteLength > maxBytes) {
		throw invalidParams(`${field} exceeds its ${maxBytes}-byte limit`);
	}
	return value;
}

function boundedPath(value: unknown, field: string): string {
	const path = boundedString(value, field, ACP_MAX_PATH_LENGTH);
	if (!isAbsolute(path)) throw invalidParams(`${field} must be an absolute path`);

	return path;
}

function validateSessionId(value: unknown): string {
	if (typeof value !== "string" || !ACP_SESSION_ID.test(value)) {
		throw invalidParams("sessionId is malformed");
	}
	return value;
}

function validateResourceUri(value: unknown, field: string): string {
	const uri = boundedString(value, field, ACP_MAX_RESOURCE_URI_LENGTH);
	try {
		// Validation is deliberately side-effect free. ACP resources are never fetched.
		new URL(uri);
	} catch {
		throw invalidParams(`${field} must be an absolute URI`);
	}
	return uri;
}

function base64ByteLength(data: string): number {
	const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
	return Math.floor((data.length * 3) / 4) - padding;
}

function validateImage(
	block: AcpImageBlock,
	index: number,
	totalImageBytes: number,
): PiImageContent {
	const mimeType = boundedString(block.mimeType, `prompt[${index}].mimeType`, 128);
	if (!ACCEPTED_IMAGE_TYPES.includes(mimeType)) {
		throw invalidParams(
			`prompt[${index}] uses unsupported image MIME type ${JSON.stringify(mimeType)}`,
		);
	}
	const data = boundedString(block.data, `prompt[${index}].data`, IMAGE_MAX_BASE64_BYTES);
	if (!data || !BASE64.test(data) || data.length % 4 !== 0) {
		throw invalidParams(`prompt[${index}].data must be valid padded base64`);
	}
	const decodedBytes = base64ByteLength(data);
	if (!Number.isSafeInteger(decodedBytes) || decodedBytes <= 0) {
		throw invalidParams(`prompt[${index}].data is empty or invalid`);
	}
	if (totalImageBytes + data.length > REQUEST_IMAGE_BASE64_BUDGET) {
		throw invalidParams(
			`prompt image data exceeds the ${REQUEST_IMAGE_BASE64_BUDGET}-byte request budget`,
		);
	}
	if (block.uri !== undefined && block.uri !== null)
		validateResourceUri(block.uri, `prompt[${index}].uri`);
	return { type: "image", data, mimeType };
}

/** Convert ACP text, image, and resource-link blocks to the existing Pi prompt shape. */
export function convertAcpPromptBlocks(blocks: readonly AcpContentBlock[]): AcpPromptInput {
	if (!Array.isArray(blocks) || blocks.length > ACP_MAX_PROMPT_BLOCKS) {
		throw invalidParams(`prompt must contain at most ${ACP_MAX_PROMPT_BLOCKS} blocks`);
	}

	const textParts: string[] = [];
	const images: PiImageContent[] = [];
	let textBytes = 0;
	let imageBytes = 0;
	for (const [index, block] of blocks.entries()) {
		if (!isRecord(block) || typeof block.type !== "string") {
			throw invalidParams(`prompt[${index}] is not a content block`);
		}
		switch (block.type) {
			case "text": {
				const text = boundedString(block.text, `prompt[${index}].text`, ACP_MAX_PROMPT_TEXT_BYTES);
				textBytes += new TextEncoder().encode(text).byteLength;
				if (textBytes > ACP_MAX_PROMPT_TEXT_BYTES) {
					throw invalidParams(
						`prompt text exceeds the ${ACP_MAX_PROMPT_TEXT_BYTES}-byte request budget`,
					);
				}
				textParts.push(text);
				break;
			}
			case "image": {
				const image = validateImage(block as unknown as AcpImageBlock, index, imageBytes);
				imageBytes += image.data.length;
				images.push(image);
				break;
			}
			case "resource_link": {
				const name = boundedString(
					block.name,
					`prompt[${index}].name`,
					ACP_MAX_RESOURCE_NAME_LENGTH,
				);
				const uri = validateResourceUri(block.uri, `prompt[${index}].uri`);
				const reference = `[resource: ${name} (${uri})]`;
				textBytes += new TextEncoder().encode(reference).byteLength;
				if (textBytes > ACP_MAX_PROMPT_TEXT_BYTES) {
					throw invalidParams(
						`prompt text exceeds the ${ACP_MAX_PROMPT_TEXT_BYTES}-byte request budget`,
					);
				}
				textParts.push(reference);
				break;
			}
			case "audio":
				throw invalidParams("audio prompt blocks are unsupported");
			case "resource":
				throw invalidParams("embedded resource prompt blocks are unsupported");
			default:
				throw invalidParams(`prompt[${index}] uses unsupported block type ${block.type}`);
		}
	}

	return {
		text: textParts.join("\n"),
		...(images.length > 0 ? { images } : {}),
	};
}

function textBlock(text: string): AcpContentBlock | undefined {
	if (new TextEncoder().encode(text).byteLength > ACP_MAX_REPLAY_TEXT_BYTES) return undefined;
	return { type: "text", text };
}

function imageBlock(image: PiImageContent): AcpContentBlock | undefined {
	if (!ACCEPTED_IMAGE_TYPES.includes(image.mimeType)) return undefined;
	if (!image.data || image.data.length > IMAGE_MAX_BASE64_BYTES || !BASE64.test(image.data)) {
		return undefined;
	}
	return { type: "image", data: image.data, mimeType: image.mimeType };
}

function transcriptContentBlock(
	block: PiTextContent | PiImageContent,
): AcpContentBlock | undefined {
	return block.type === "text" ? textBlock(block.text) : imageBlock(block);
}

function toolKind(name: string): acp.ToolKind {
	const normalized = name.toLowerCase();
	if (normalized === "read" || normalized === "ls") return "read";
	if (normalized === "find" || normalized === "grep" || normalized.includes("search"))
		return "search";
	if (normalized === "edit" || normalized === "write") return "edit";
	if (normalized.includes("delete") || normalized.includes("remove")) return "delete";
	if (normalized.includes("move") || normalized.includes("rename")) return "move";
	if (normalized.includes("fetch") || normalized.includes("web")) return "fetch";
	if (normalized === "bash" || normalized.includes("terminal") || normalized.includes("shell"))
		return "execute";
	return "other";
}

function toolContentBlocks(value: unknown): acp.ToolCallContent[] {
	if (!Array.isArray(value)) return [];
	const content: acp.ToolCallContent[] = [];
	for (const item of value) {
		if (!isRecord(item) || (item.type !== "text" && item.type !== "image")) continue;
		const block = transcriptContentBlock(item as unknown as PiTextContent | PiImageContent);
		if (block) content.push({ type: "content", content: block });
	}
	return content;
}

function toolResultParts(value: unknown): { content: acp.ToolCallContent[]; details?: unknown } {
	if (!isRecord(value)) return { content: [] };
	const result = {
		content: toolContentBlocks(value.content),
		...(value.details !== undefined ? { details: value.details } : {}),
	};
	return result;
}

function replayMessageId(index: number): string {
	return `history-${index}`;
}

function replayUserMessage(
	message: Extract<TranscriptMessage, { role: "user" }>,
	index: number,
): AcpUpdate[] {
	const blocks =
		typeof message.content === "string"
			? [textBlock(message.content)]
			: message.content.map(transcriptContentBlock);
	return blocks.flatMap((content) =>
		content
			? [
					{
						sessionUpdate: "user_message_chunk" as const,
						messageId: replayMessageId(index),
						content,
					},
				]
			: [],
	);
}

function replayAssistantMessage(
	message: Extract<TranscriptMessage, { role: "assistant" }>,
	index: number,
): AcpUpdate[] {
	const messageId = replayMessageId(index);
	return message.content.flatMap((block): AcpUpdate[] => {
		if (block.type === "text") {
			const content = textBlock(block.text);
			return content ? [{ sessionUpdate: "agent_message_chunk" as const, messageId, content }] : [];
		}
		if (block.type === "thinking") {
			const content = textBlock(block.thinking);
			return content ? [{ sessionUpdate: "agent_thought_chunk" as const, messageId, content }] : [];
		}
		const tool = block as PiToolCall;
		return [
			{
				sessionUpdate: "tool_call" as const,
				toolCallId: tool.id,
				title: tool.name,
				kind: toolKind(tool.name),
				status: "pending" as const,
				rawInput: tool.arguments,
			},
		];
	});
}

function replayToolResult(message: ToolResultMessage): AcpUpdate {
	const parts = toolResultParts(message);
	return {
		sessionUpdate: "tool_call_update",
		toolCallId: message.toolCallId,
		status: message.isError ? "failed" : "completed",
		...(parts.content.length > 0 ? { content: parts.content } : {}),
		...(parts.details !== undefined ? { rawOutput: parts.details } : {}),
	};
}

/** Project one persisted Pi message into the supported ACP replay update shapes. */
export function projectTranscriptMessage(message: TranscriptMessage, index: number): AcpUpdate[] {
	if (message.role === "user") return replayUserMessage(message, index);
	if (message.role === "assistant") return replayAssistantMessage(message, index);
	if (message.role === "toolResult") return [replayToolResult(message)];
	return [];
}

function projectToolCall(tool: PiToolCall, status: acp.ToolCallStatus): AcpUpdate {
	return {
		sessionUpdate: "tool_call",
		toolCallId: tool.id,
		title: tool.name,
		kind: toolKind(tool.name),
		status,
		rawInput: tool.arguments,
	};
}

function projectPiEvent(event: PiEvent): AcpUpdate | undefined {
	switch (event.type) {
		case "message_update": {
			const update = event.assistantMessageEvent;
			if (update.type === "text_delta") {
				return {
					sessionUpdate: "agent_message_chunk",
					content: { type: "text", text: update.delta },
				};
			}
			if (update.type === "thinking_delta") {
				return {
					sessionUpdate: "agent_thought_chunk",
					content: { type: "text", text: update.delta },
				};
			}
			if (update.type === "toolcall_end") return projectToolCall(update.toolCall, "pending");
			return undefined;
		}
		case "tool_execution_start":
			return {
				sessionUpdate: "tool_call_update",
				toolCallId: event.toolCallId,
				title: event.toolName,
				kind: toolKind(event.toolName),
				status: "in_progress",
				rawInput: event.args,
			};
		case "tool_execution_update": {
			const result = toolResultParts(event.partialResult);
			return {
				sessionUpdate: "tool_call_update",
				toolCallId: event.toolCallId,
				status: "in_progress",
				...(result.content.length > 0 ? { content: result.content } : {}),
				...(result.details !== undefined ? { rawOutput: result.details } : {}),
			};
		}
		case "tool_execution_end": {
			const result = toolResultParts(event.result);
			return {
				sessionUpdate: "tool_call_update",
				toolCallId: event.toolCallId,
				status: event.isError ? "failed" : "completed",
				...(result.content.length > 0 ? { content: result.content } : {}),
				...(result.details !== undefined ? { rawOutput: result.details } : {}),
			};
		}
		case "session_info_changed":
			return { sessionUpdate: "session_info_update", title: event.name ?? null };
		default:
			// ACP v1 has no stable projection for plans, compaction, retries, usage, or queues.
			return undefined;
	}
}

/** Project the existing Pi event stream into ACP v1 session/update notifications. */
export function projectAcpEvent(event: PiEvent): AcpUpdate | undefined {
	return projectPiEvent(event);
}

function isWithin(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function findProjectForCwd(
	cwd: string,
	dependencies: AcpConnectorDependencies,
): ProjectAdmission | undefined {
	for (const project of dependencies.getProjects()) {
		for (const root of project.roots) {
			let admittedRoot: string;
			try {
				admittedRoot = dependencies.assertMountedDirectory(root, "ACP project root");
			} catch {
				continue;
			}
			if (isWithin(admittedRoot, cwd)) {
				return { cwd, projectId: project.id };
			}
		}
	}
	return undefined;
}

function admitProject(rawCwd: unknown, dependencies: AcpConnectorDependencies): ProjectAdmission {
	const requestedCwd = boundedPath(rawCwd, "cwd");
	let cwd: string;
	try {
		cwd = dependencies.assertMountedDirectory(requestedCwd, "ACP cwd");
	} catch {
		throw invalidParams("cwd is not an existing directory under MEWA_MOUNT_ROOTS");
	}

	try {
		const existing = findProjectForCwd(cwd, dependencies);
		if (existing) return existing;

		const project = dependencies.openProject(cwd);
		return { cwd: dependencies.assertProjectCwd(project.id, cwd), projectId: project.id };
	} catch {
		throw invalidParams("cwd must belong to an admitted project root");
	}
}

function sameOwner(left: SessionOwner, right: SessionOwner): boolean {
	return left.projectId === right.projectId && left.cwd === right.cwd;
}

class AcpNotifier {
	private tail: Promise<void> = Promise.resolve();

	public constructor(private client: acp.AgentContext | undefined) {}

	public setClient(client: acp.AgentContext): void {
		this.client = client;
	}

	public emit(sessionId: string, update: AcpUpdate): void {
		this.tail = this.tail.then(async () => {
			if (!this.client) return;
			try {
				await this.client.notify(acp.methods.client.session.update, { sessionId, update });
			} catch (error) {
				// A client closing stdin while Pi is settling must not produce an unhandled rejection.
				console.error(
					`ACP session update delivery failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		});
	}

	public flush(): Promise<void> {
		return this.tail;
	}
}

export interface AcpConnectorOptions {
	appVersion?: string;
	/** Test-only dependency overrides. Production uses the process-global defaults. */
	dependencies?: Partial<AcpConnectorDependencies>;
}

export interface AcpAgentHandle {
	app: acp.AgentApp;
	close: () => Promise<void>;
}

class AcpConnector {
	private readonly dependencies: AcpConnectorDependencies;
	private readonly owners = new Map<string, SessionOwner>();
	private readonly activePrompts = new Map<string, Promise<acp.PromptResponse>>();
	private readonly notifier = new AcpNotifier(undefined);
	private closeTask: Promise<void> | undefined;
	public readonly app: acp.AgentApp;

	public constructor(private readonly options: AcpConnectorOptions) {
		this.dependencies = {
			...DEFAULT_ACP_CONNECTOR_DEPENDENCIES,
			...options.dependencies,
		};
		this.app = acp
			.agent({ name: "mewa-code" })
			.onConnect((connection) => {
				this.notifier.setClient(connection.client);
				connection.signal.addEventListener(
					"abort",
					() => {
						void this.close();
					},
					{ once: true },
				);
			})
			.onRequest(acp.methods.agent.initialize, ({ params }) => this.initialize(params))
			.onRequest(acp.methods.agent.session.new, ({ params }) => this.newSession(params))
			.onRequest(acp.methods.agent.session.load, ({ params }) => this.loadSession(params))
			.onRequest(acp.methods.agent.session.prompt, (context) => this.prompt(context))
			.onNotification(acp.methods.agent.session.cancel, ({ params }) => this.cancel(params));

		this.dependencies.setSessionPublisher(({ sessionId, event }) => {
			if (!this.owners.has(sessionId)) return;
			const update = projectPiEvent(event);
			if (update) this.notifier.emit(sessionId, update);
		});
		this.dependencies.setSessionDeletedPublisher(() => {});
		this.dependencies.setExtUiPublisher((request) => {
			if (request.kind !== "notify") this.dependencies.cancelExtUiForSession(request.sessionId);
		});
	}

	private initialize(_params: acp.InitializeRequest): acp.InitializeResponse {
		return {
			protocolVersion: acp.PROTOCOL_VERSION,
			agentInfo: {
				name: "mewa-code",
				title: "Mewa Code",
				version: this.options.appVersion ?? "0.0.0-dev",
			},
			authMethods: [],
			agentCapabilities: {
				loadSession: true,
				promptCapabilities: { image: true },
			},
		};
	}

	private validateSessionSetup(params: {
		additionalDirectories?: string[];
		mcpServers: unknown[];
	}): void {
		if (params.mcpServers.length > 0) throw invalidParams("ACP MCP servers are unsupported");
	}

	private addDirectories(projectId: string, directories: string[] | undefined): void {
		for (const raw of directories ?? []) {
			const directory = boundedPath(raw, "additionalDirectories");
			try {
				this.dependencies.addProjectRoot(projectId, directory);
			} catch {
				throw invalidParams(
					"additionalDirectories must be admitted directories not owned by another project",
				);
			}
		}
	}

	private async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
		this.validateSessionSetup(params);
		const admission = admitProject(params.cwd, this.dependencies);
		this.addDirectories(admission.projectId, params.additionalDirectories);
		let created: Awaited<ReturnType<typeof createSession>>;
		try {
			created = await this.dependencies.createSession({
				cwd: admission.cwd,
				projectId: admission.projectId,
			});
		} catch {
			throw internalError("Pi could not create the requested session");
		}
		this.owners.set(created.sessionId, admission);
		return { sessionId: created.sessionId };
	}

	private async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
		this.validateSessionSetup(params);
		const sessionId = validateSessionId(params.sessionId);
		const admission = admitProject(params.cwd, this.dependencies);
		this.addDirectories(admission.projectId, params.additionalDirectories);
		const existingOwner = this.owners.get(sessionId);
		if (existingOwner && !sameOwner(existingOwner, admission)) {
			throw invalidParams("sessionId is not owned by the requested cwd");
		}

		let loaded: Awaited<ReturnType<typeof getSessionMessages>>;
		try {
			loaded = await this.dependencies.getSessionMessages(
				sessionId,
				admission.projectId,
				admission.cwd,
			);
		} catch {
			throw invalidParams("sessionId is unknown or does not belong to the requested cwd");
		}
		const owner = { projectId: admission.projectId, cwd: admission.cwd };
		if (
			this.dependencies.getSessionProjectId(sessionId) !== owner.projectId ||
			this.dependencies.getSessionCwd(sessionId) !== owner.cwd
		) {
			throw invalidParams("sessionId is not owned by the requested project and cwd");
		}
		this.owners.set(sessionId, owner);

		// A load replay is queued after any synchronous attach events and before the response.
		await this.notifier.flush();
		for (const [index, message] of loaded.messages.entries()) {
			for (const update of projectTranscriptMessage(message, index))
				this.notifier.emit(sessionId, update);
		}
		await this.notifier.flush();
		return {};
	}

	private ownerFor(sessionId: unknown): SessionOwner {
		const id = validateSessionId(sessionId);
		const owner = this.owners.get(id);
		if (!owner) throw invalidParams("sessionId is not attached to this ACP connection");
		return owner;
	}

	private async prompt(
		context: acp.AgentRequestContext<acp.PromptRequest>,
	): Promise<acp.PromptResponse> {
		this.ownerFor(context.params.sessionId);
		const input = convertAcpPromptBlocks(context.params.prompt);
		if (
			this.activePrompts.has(context.params.sessionId) ||
			this.dependencies.isSessionStreaming(context.params.sessionId)
		) {
			throw invalidParams("session prompt is already in progress");
		}

		const task = this.runPrompt(context, input);
		this.activePrompts.set(context.params.sessionId, task);
		try {
			return await task;
		} finally {
			if (this.activePrompts.get(context.params.sessionId) === task)
				this.activePrompts.delete(context.params.sessionId);
		}
	}

	private async runPrompt(
		context: acp.AgentRequestContext<acp.PromptRequest>,
		input: AcpPromptInput,
	): Promise<acp.PromptResponse> {
		const sessionId = context.params.sessionId;
		const onAbort = (): void => {
			void this.dependencies.abortSession(sessionId).catch(() => {});
		};
		context.signal.addEventListener("abort", onAbort, { once: true });
		try {
			try {
				await this.dependencies.promptSession(sessionId, input.text, input.images);
			} catch (error) {
				if (context.signal.aborted) throw acp.RequestError.requestCancelled();
				console.error(
					`ACP Pi prompt failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				throw internalError("Pi prompt failed");
			}
			await this.notifier.flush();
			if (context.signal.aborted) throw acp.RequestError.requestCancelled();
			const settlement = this.dependencies.getSessionSettlement(sessionId);
			if (!settlement) return { stopReason: "end_turn" };
			switch (settlement.stopReason) {
				case "aborted":
					return { stopReason: "cancelled" };
				case "length":
					return { stopReason: "max_tokens" };
				case "error":
					throw internalError("Pi prompt failed");
				case "deferred":
					return { stopReason: "max_turn_requests" };
				default:
					return { stopReason: "end_turn" };
			}
		} finally {
			context.signal.removeEventListener("abort", onAbort);
		}
	}

	private async cancel(params: acp.CancelNotification): Promise<void> {
		const sessionId = validateSessionId(params.sessionId);
		if (!this.owners.has(sessionId)) return;
		try {
			await this.dependencies.abortSession(sessionId);
		} catch {
			// Cancellation is a notification. A race with settlement is intentionally harmless.
		}
	}

	public async close(): Promise<void> {
		if (this.closeTask) return this.closeTask;
		this.closeTask = (async () => {
			await this.dependencies.settleSessionsForShutdown();
			await this.notifier.flush();
			this.dependencies.disposeAllSessions();
			this.dependencies.setSessionPublisher(() => {});
			this.dependencies.setSessionDeletedPublisher(() => {});
			this.dependencies.setExtUiPublisher(() => {});
		})();
		return this.closeTask;
	}
}

/** Build a typed ACP agent application for tests or an explicit stdio runner. */
export function createAcpAgent(options: AcpConnectorOptions = {}): AcpAgentHandle {
	const connector = new AcpConnector(options);
	return { app: connector.app, close: () => connector.close() };
}

/** Initialize the same process-global controller resources used by browser mode. */
export async function prepareAcpRuntime(appVersion?: string): Promise<void> {
	installCrashLog(appVersion);
	resolveShellEnv();
	await getPiRuntime();
}

export interface RunAcpOptions extends AcpConnectorOptions {
	/** Inject streams for focused tests. Defaults to process stdio. */
	input?: ReadableStream<Uint8Array>;
	output?: WritableStream<Uint8Array>;
}

/** Run the controller's ACP v1 connector over stdin/stdout. */
export async function runAcp(options: RunAcpOptions = {}): Promise<void> {
	await prepareAcpRuntime(options.appVersion);
	const connector = createAcpAgent(options);
	const input =
		options.input ?? (Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>);
	const output =
		options.output ?? (Writable.toWeb(process.stdout) as unknown as WritableStream<Uint8Array>);
	const stream = acp.ndJsonStream(output, input);
	const connection = connector.app.connect(stream);
	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		void connector.close().then(() => connection.close());
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	try {
		await connection.closed;
	} finally {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		await connector.close();
	}
}
