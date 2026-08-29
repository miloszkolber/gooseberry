import * as acp from "@agentclientprotocol/sdk";
import {
	createWebSocketStream,
	type WebSocketConstructor,
} from "@agentclientprotocol/sdk/experimental/ws-client";
import type {
	GooseClientEvent,
	GooseConfigOption,
	GooseConfiguredExtension,
	GooseConnection,
	GooseConnectionFactory,
	GooseContextUsage,
	GooseExtension,
	GooseImage,
	GooseMcpServer,
	GooseModel,
	GoosePermissionDecision,
	GoosePermissionHandler,
	GoosePermissionRequest,
	GoosePromptContent,
	GooseProvider,
	GooseProviderConfigField,
	GooseRecipe,
	GooseRecipeListEntry,
	GooseSchedule,
	GooseScheduledJobInspection,
	GooseSession,
	GooseSessionInfo,
	GooseSlashCommand,
	GooseTool,
	GooseToolPermission,
	GooseUpdate,
	GooseUsage,
	JsonValue,
} from "./types";

const DEFAULT_URL = "ws://127.0.0.1:3284/acp";
const DEFAULT_TIMEOUT_MS = 30_000;

const loadNodeWebSocket = new Function("return import('ws')") as () => Promise<{
	default: WebSocketConstructor;
}>;

export class GooseConnectionLostError extends Error {
	constructor(message = "Goose ACP connection closed") {
		super(message);
		this.name = "GooseConnectionLostError";
	}
}

export class GooseTimeoutError extends Error {
	constructor(operation: string, timeoutMs: number) {
		super(`${operation} timed out after ${timeoutMs}ms`);
		this.name = "GooseTimeoutError";
	}
}

export interface GooseClientOptions {
	url?: string;
	secretKey?: string;
	clientName?: string;
	clientVersion?: string;
	timeoutMs?: number;
	permissionHandler?: GoosePermissionHandler;
	connectionFactory?: GooseConnectionFactory;
}

export interface GooseRequestOptions {
	signal?: AbortSignal;
	/** Use null to disable the client timeout for a long-running request. */
	timeoutMs?: number | null;
	/** Refuse a request if a reconnect selected a different ACP generation. */
	connectionGeneration?: number;
}

type Listener = (event: GooseClientEvent) => void;

/**
 * Goose v1.48.0 ACP facade. It deliberately exposes normalized data only and
 * preserves no uncertain mutation for reconnect replay.
 */
export class GooseClient {
	readonly #options: Required<
		Pick<GooseClientOptions, "url" | "clientName" | "clientVersion" | "timeoutMs">
	> &
		GooseClientOptions;
	readonly #listeners = new Set<Listener>();
	#connection: GooseConnection | undefined;
	#ready: Promise<void> | undefined;
	#generation = 0;
	#readyGeneration: number | undefined;
	#closed = false;

	constructor(options: GooseClientOptions = {}) {
		this.#options = {
			...options,
			url: options.url ?? DEFAULT_URL,
			clientName: options.clientName ?? "gooseberry",
			clientVersion: options.clientVersion ?? "0.0.0",
			timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		};
	}

	on(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	get isReady(): boolean {
		return this.#connection !== undefined && this.#readyGeneration !== undefined;
	}

	/** The ready ACP generation, or zero while disconnected. */
	get connectionGeneration(): number {
		return this.#readyGeneration ?? 0;
	}

	async ready(options: GooseRequestOptions = {}): Promise<void> {
		if (this.#closed) throw new GooseConnectionLostError("Goose client has been shut down");
		if (!this.#ready) {
			const ready = this.#openAndInitialize();
			this.#ready = ready;
			void ready.catch((error: unknown) => {
				if (this.#ready === ready) {
					this.#dropConnection();
					this.#emit({ type: "protocol-error", error: asError(error) });
				}
			});
		}
		return this.#withBounds(this.#ready, "initialize", options);
	}

	async reconnect(options: GooseRequestOptions = {}): Promise<void> {
		this.#dropConnection();
		return this.ready(options);
	}

	async createSession(
		input: {
			cwd: string;
			title?: string;
			projectId?: string;
			additionalDirectories?: string[];
			mcpServers?: readonly GooseMcpServer[];
			recipeId?: string;
		},
		options?: GooseRequestOptions,
	): Promise<GooseSessionInfo> {
		const meta: Record<string, unknown> = {};
		if (input.title) meta.sessionTitle = input.title;
		if (input.projectId) meta.projectId = input.projectId;
		if (input.recipeId) meta.recipeId = input.recipeId;
		const response = await this.#request(
			"session/new",
			{
				cwd: input.cwd,
				mcpServers: input.mcpServers ?? [],
				...(input.additionalDirectories
					? { additionalDirectories: input.additionalDirectories }
					: {}),
				...(Object.keys(meta).length ? { _meta: meta } : {}),
			},
			options,
		);
		return normalizeSessionInfo(response, requiredString(response, "sessionId"));
	}

	async loadSession(
		sessionId: string,
		cwd: string,
		options?: GooseRequestOptions & { mcpServers?: readonly GooseMcpServer[] },
	): Promise<GooseSessionInfo> {
		const response = await this.#request(
			"session/load",
			{ sessionId, cwd, mcpServers: options?.mcpServers ?? [] },
			options,
		);
		return normalizeSessionInfo(response, sessionId);
	}

	async listSessions(
		input: { cwd?: string; cursor?: string; limit?: number } = {},
		options?: GooseRequestOptions,
	): Promise<{ sessions: GooseSession[]; nextCursor?: string }> {
		const response = object(await this.#request("session/list", input, options));
		const nextCursor = string(response.nextCursor);
		return nextCursor === undefined
			? { sessions: array(response.sessions).map(normalizeSession) }
			: { sessions: array(response.sessions).map(normalizeSession), nextCursor };
	}

	async deleteSession(sessionId: string, options?: GooseRequestOptions): Promise<void> {
		await this.#request("session/delete", { sessionId }, options);
	}
	renameSession(sessionId: string, title: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/session/rename", { sessionId, title }, options).then(
			() => {},
		);
	}
	archiveSession(sessionId: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/session/archive", { sessionId }, options).then(() => {});
	}
	unarchiveSession(sessionId: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/session/unarchive", { sessionId }, options).then(() => {});
	}

	async forkSession(
		sessionId: string,
		cwd: string,
		options?: GooseRequestOptions & { mcpServers?: readonly GooseMcpServer[] },
	): Promise<GooseSessionInfo> {
		const response = await this.#request(
			"session/fork",
			{ sessionId, cwd, mcpServers: options?.mcpServers ?? [] },
			options,
		);
		return normalizeSessionInfo(response, requiredString(response, "sessionId"));
	}

	prompt(
		sessionId: string,
		text: string,
		images: readonly GooseImage[] = [],
		options?: GooseRequestOptions,
	): Promise<{ stopReason?: string }> {
		const prompt: GoosePromptContent[] = [
			{ type: "text", text },
			...images.map((image) => ({ type: "image" as const, ...image })),
		];
		return this.#request(
			"session/prompt",
			{ sessionId, prompt },
			{ timeoutMs: null, ...options },
		).then((result) => {
			const stopReason = string(object(result).stopReason);
			return stopReason === undefined ? {} : { stopReason };
		});
	}

	cancel(sessionId: string, options?: GooseRequestOptions): Promise<void> {
		return this.#notify("session/cancel", { sessionId }, options);
	}

	steer(
		sessionId: string,
		expectedRunId: string,
		text: string,
		images: readonly GooseImage[] = [],
		options?: GooseRequestOptions,
	): Promise<{ runId: string; messageId: string }> {
		const prompt: GoosePromptContent[] = [
			{ type: "text", text },
			...images.map((image) => ({ type: "image" as const, ...image })),
		];
		return this.#request(
			"_goose/unstable/session/steer",
			{ sessionId, expectedRunId, prompt },
			options,
		).then((result) => {
			const response = object(result);
			return {
				runId: requiredString(response, "runId"),
				messageId: requiredString(response, "messageId"),
			};
		});
	}

	setProvider(
		sessionId: string,
		providerId: string,
		options?: GooseRequestOptions,
	): Promise<GooseConfigOption[]> {
		return this.#setConfig(sessionId, "provider", providerId, options);
	}
	setModel(
		sessionId: string,
		modelId: string,
		options?: GooseRequestOptions,
	): Promise<GooseConfigOption[]> {
		return this.#setConfig(sessionId, "model", modelId, options);
	}
	setThinking(
		sessionId: string,
		thinking: string,
		options?: GooseRequestOptions,
	): Promise<GooseConfigOption[]> {
		return this.#setConfig(sessionId, "thinking_effort", thinking, options);
	}

	async sessionInfo(sessionId: string, options?: GooseRequestOptions): Promise<GooseSessionInfo> {
		const result = await this.custom("_goose/unstable/session/info", { sessionId }, options);
		return normalizeSessionInfo(result, sessionId);
	}

	async listProviders(
		providerIds: string[] = [],
		options?: GooseRequestOptions,
	): Promise<GooseProvider[]> {
		const response = object(
			await this.custom("_goose/unstable/providers/list", { providerIds }, options),
		);
		return array(response.entries).map(normalizeProvider);
	}
	listProviderModels(providerId: string, options?: GooseRequestOptions): Promise<GooseModel[]> {
		return this.custom<{ models?: unknown }>(
			"_goose/unstable/providers/supported-models/list",
			{ providerId },
			options,
		).then((r) =>
			array(r.models).map((model) =>
				typeof model === "string"
					? { id: model, name: model, providerId, raw: model }
					: normalizeModel(model),
			),
		);
	}
	providerCatalog(format?: string, options?: GooseRequestOptions): Promise<unknown> {
		return this.custom("_goose/unstable/providers/catalog/list", format ? { format } : {}, options);
	}
	providerConfig(
		providerId: string,
		options?: GooseRequestOptions,
	): Promise<GooseProviderConfigField[]> {
		return this.custom<{ fields?: unknown }>(
			"_goose/unstable/providers/config/read",
			{ providerId },
			options,
		).then((response) => array(response.fields).map(normalizeProviderConfigField));
	}
	providerConfigStatus(
		providerIds: string[] = [],
		options?: GooseRequestOptions,
	): Promise<unknown> {
		return this.custom("_goose/unstable/providers/config/status", { providerIds }, options);
	}
	saveProviderConfig(
		providerId: string,
		fields: readonly { key: string; value: string }[],
		options?: GooseRequestOptions,
	): Promise<unknown> {
		return this.custom("_goose/unstable/providers/config/save", { providerId, fields }, options);
	}
	deleteProviderConfig(providerId: string, options?: GooseRequestOptions): Promise<unknown> {
		return this.custom("_goose/unstable/providers/config/delete", { providerId }, options);
	}
	authenticateProvider(providerId: string, options?: GooseRequestOptions): Promise<unknown> {
		return this.custom("_goose/unstable/providers/config/authenticate", { providerId }, options);
	}
	refreshProviderInventory(
		providerIds: string[] = [],
		options?: GooseRequestOptions,
	): Promise<unknown> {
		return this.custom("_goose/unstable/providers/inventory/refresh", { providerIds }, options);
	}
	custom<T = unknown>(
		method: string,
		params: Record<string, unknown> = {},
		options?: GooseRequestOptions,
	): Promise<T> {
		return this.#request(method, params, options) as Promise<T>;
	}

	listRecipes(options?: GooseRequestOptions): Promise<GooseRecipeListEntry[]> {
		return this.custom<{ recipes?: unknown }>("_goose/unstable/recipes/list", {}, options).then(
			(r) => array(r.recipes).map(normalizeRecipeListEntry),
		);
	}
	encodeRecipe(recipe: GooseRecipe, options?: GooseRequestOptions): Promise<{ deeplink: string }> {
		return this.custom("_goose/unstable/recipes/encode", { recipe }, options);
	}
	decodeRecipe(deeplink: string, options?: GooseRequestOptions): Promise<GooseRecipe> {
		return this.custom<{ recipe: unknown }>(
			"_goose/unstable/recipes/decode",
			{ deeplink },
			options,
		).then((r) => normalizeRecipe(r.recipe));
	}
	scanRecipe(
		recipe: GooseRecipe,
		options?: GooseRequestOptions,
	): Promise<{ hasSecurityWarnings: boolean }> {
		return this.custom<{ has_security_warnings?: unknown }>(
			"_goose/unstable/recipes/scan",
			{ recipe },
			options,
		).then((response) => ({ hasSecurityWarnings: response.has_security_warnings === true }));
	}
	saveRecipe(
		recipe: GooseRecipe,
		id?: string,
		options?: GooseRequestOptions,
	): Promise<{ id: string; fileName: string; filePath: string }> {
		return this.custom<{ id?: unknown; file_name?: unknown; file_path?: unknown }>(
			"_goose/unstable/recipes/save",
			{ recipe, ...(id ? { id } : {}) },
			options,
		).then((response) => ({
			id: requiredString(response, "id"),
			fileName: requiredString(response, "file_name"),
			filePath: requiredString(response, "file_path"),
		}));
	}
	deleteRecipe(id: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/recipes/delete", { id }, options).then(() => {});
	}
	parseRecipe(content: string, options?: GooseRequestOptions): Promise<GooseRecipe> {
		return this.custom<{ recipe: unknown }>(
			"_goose/unstable/recipes/parse",
			{ content },
			options,
		).then((r) => normalizeRecipe(r.recipe));
	}
	recipeToYaml(recipe: GooseRecipe, options?: GooseRequestOptions): Promise<{ yaml: string }> {
		return this.custom("_goose/unstable/recipes/to-yaml", { recipe }, options);
	}
	setRecipeSchedule(
		id: string,
		cronSchedule?: string,
		options?: GooseRequestOptions,
	): Promise<void> {
		return this.custom(
			"_goose/unstable/recipes/schedule",
			{ id, ...(cronSchedule ? { cron_schedule: cronSchedule } : {}) },
			options,
		).then(() => {});
	}
	setRecipeSlashCommand(
		id: string,
		slashCommand?: string,
		options?: GooseRequestOptions,
	): Promise<void> {
		return this.custom(
			"_goose/unstable/recipes/slash-command",
			{ id, ...(slashCommand ? { slash_command: slashCommand } : {}) },
			options,
		).then(() => {});
	}
	listSchedules(options?: GooseRequestOptions): Promise<GooseSchedule[]> {
		return this.custom<{ jobs?: unknown }>("_goose/unstable/schedules/list", {}, options).then(
			(r) => array(r.jobs).map(normalizeSchedule),
		);
	}
	createSchedule(
		id: string,
		recipe: GooseRecipe,
		cron: string,
		options?: GooseRequestOptions,
	): Promise<GooseSchedule> {
		return this.custom<{ job: unknown }>(
			"_goose/unstable/schedules/create",
			{ id, recipe, cron },
			options,
		).then((r) => normalizeSchedule(r.job));
	}
	updateSchedule(
		scheduleId: string,
		cron: string,
		options?: GooseRequestOptions,
	): Promise<GooseSchedule> {
		return this.custom<{ job: unknown }>(
			"_goose/unstable/schedules/update",
			{ scheduleId, cron },
			options,
		).then((r) => normalizeSchedule(r.job));
	}
	deleteSchedule(scheduleId: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/schedules/delete", { scheduleId }, options).then(() => {});
	}
	runScheduleNow(
		scheduleId: string,
		options?: GooseRequestOptions,
	): Promise<{ status: string; sessionId?: string }> {
		return this.custom("_goose/unstable/schedules/run-now", { scheduleId }, options);
	}
	pauseSchedule(scheduleId: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/schedules/pause", { scheduleId }, options).then(() => {});
	}
	unpauseSchedule(scheduleId: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/schedules/unpause", { scheduleId }, options).then(() => {});
	}
	listScheduleSessions(
		scheduleId: string,
		limit: number,
		options?: GooseRequestOptions,
	): Promise<GooseSession[]> {
		return this.custom<{ sessions?: unknown }>(
			"_goose/unstable/schedules/sessions/list",
			{ scheduleId, limit },
			options,
		).then((r) => array(r.sessions).map(normalizeSession));
	}
	killScheduledJob(jobId: string, options?: GooseRequestOptions): Promise<{ message: string }> {
		return this.custom("_goose/unstable/schedules/running-job/kill", { jobId }, options);
	}
	inspectScheduledJob(
		jobId: string,
		options?: GooseRequestOptions,
	): Promise<GooseScheduledJobInspection> {
		return this.custom("_goose/unstable/schedules/running-job/inspect", { jobId }, options).then(
			normalizeScheduledJobInspection,
		);
	}
	listSlashCommands(
		input: { sessionId?: string; cwd?: string },
		options?: GooseRequestOptions,
	): Promise<GooseSlashCommand[]> {
		return this.custom<{ availableCommands?: unknown }>(
			"_goose/unstable/slash-commands/list",
			input,
			options,
		).then((response) => array(response.availableCommands).map(normalizeSlashCommand));
	}
	listTools(
		sessionId: string,
		extensionName?: string,
		options?: GooseRequestOptions,
	): Promise<GooseTool[]> {
		return this.custom<{ tools?: unknown }>(
			"_goose/unstable/tools/list",
			{ sessionId, ...(extensionName ? { extensionName } : {}) },
			options,
		).then((r) => array(r.tools).map(normalizeTool));
	}
	async listConfiguredExtensions(
		options?: GooseRequestOptions,
	): Promise<{ extensions: GooseConfiguredExtension[]; warnings: string[] }> {
		const response = object(
			await this.custom("_goose/unstable/config/extensions/list", {}, options),
		);
		return {
			extensions: array(response.extensions).map(normalizeConfiguredExtension),
			warnings: array(response.warnings).filter(
				(warning): warning is string => typeof warning === "string",
			),
		};
	}
	listAvailableExtensions(options?: GooseRequestOptions): Promise<GooseExtension[]> {
		return this.custom<{ extensions?: unknown }>(
			"_goose/unstable/extensions/available",
			{},
			options,
		).then((response) => array(response.extensions).map(normalizeExtension));
	}
	addExtension(
		extension: GooseExtension,
		enabled: boolean,
		options?: GooseRequestOptions,
	): Promise<void> {
		return this.custom(
			"_goose/unstable/config/extensions/add",
			{ extension: extension.raw, enabled },
			options,
		).then(() => {});
	}
	removeExtension(configKey: string, options?: GooseRequestOptions): Promise<void> {
		return this.custom("_goose/unstable/config/extensions/remove", { configKey }, options).then(
			() => {},
		);
	}
	setExtensionEnabled(
		configKey: string,
		enabled: boolean,
		options?: GooseRequestOptions,
	): Promise<void> {
		return this.custom(
			"_goose/unstable/config/extensions/set-enabled",
			{ configKey, enabled },
			options,
		).then(() => {});
	}
	listSessionExtensions(
		sessionId: string,
		options?: GooseRequestOptions,
	): Promise<GooseExtension[]> {
		return this.custom<{ extensions?: unknown }>(
			"_goose/unstable/session/extensions/list",
			{ sessionId },
			options,
		).then((response) => array(response.extensions).map(normalizeExtension));
	}
	addSessionExtension(
		sessionId: string,
		extension: GooseExtension,
		options?: GooseRequestOptions,
	): Promise<void> {
		return this.custom(
			"_goose/unstable/session/extensions/add",
			{ sessionId, extension: extension.raw },
			options,
		).then(() => {});
	}
	removeSessionExtension(
		sessionId: string,
		name: string,
		options?: GooseRequestOptions,
	): Promise<void> {
		return this.custom(
			"_goose/unstable/session/extensions/remove",
			{ sessionId, name },
			options,
		).then(() => {});
	}
	setToolPermissions(
		toolPermissions: readonly { toolName: string; permission: GooseToolPermission }[],
		options?: GooseRequestOptions,
	): Promise<void> {
		for (const tool of toolPermissions) {
			if (normalizeToolPermission(tool.permission) !== tool.permission) {
				throw new Error("Unknown Goose tool permission");
			}
		}
		return this.custom("_goose/unstable/tools/permissions/set", { toolPermissions }, options).then(
			() => {},
		);
	}

	shutdown(): void {
		this.#closed = true;
		this.#dropConnection();
	}

	/** Drop a stuck transport while keeping this client reusable for the next request. */
	resetConnection(): void {
		if (!this.#closed) this.#dropConnection();
	}

	async #setConfig(
		sessionId: string,
		configId: string,
		value: string,
		options?: GooseRequestOptions,
	): Promise<GooseConfigOption[]> {
		const result = await this.#request(
			"session/set_config_option",
			{ sessionId, configId, value },
			options,
		);
		return normalizeConfigOptions(object(result).configOptions);
	}

	async #openAndInitialize(): Promise<void> {
		const factory =
			this.#options.connectionFactory ??
			webSocketConnectionFactory(this.#options.url, this.#options.secretKey);
		const connection = await factory.connect({
			onSessionUpdate: (params) => this.#emitUpdate(normalizeStandardUpdate(params)),
			onGooseNotification: (method, params) => this.#onGooseNotification(method, params),
			onPermission: (params, signal) => this.#onPermission(params, signal),
		});
		this.#connection = connection;
		const generation = ++this.#generation;
		void connection.closed.then(() => {
			if (this.#connection === connection) this.#dropConnection();
		});
		await this.#withBounds(
			connection.request("initialize", {
				protocolVersion: acp.PROTOCOL_VERSION,
				clientInfo: { name: this.#options.clientName, version: this.#options.clientVersion },
				clientCapabilities: { _meta: { goose: { customNotifications: true } } },
			}),
			"initialize",
			{},
		);
		if (this.#connection !== connection) throw new GooseConnectionLostError();
		this.#readyGeneration = generation;
		this.#emit({ type: "ready", generation });
	}

	async #request(
		method: string,
		params: Record<string, unknown>,
		options: GooseRequestOptions = {},
	): Promise<unknown> {
		await this.ready(options);
		if (
			options.connectionGeneration !== undefined &&
			this.connectionGeneration !== options.connectionGeneration
		) {
			throw new GooseConnectionLostError("Goose ACP connection generation changed");
		}
		const connection = this.#connection;
		if (!connection) throw new GooseConnectionLostError();
		return this.#withBounds(
			Promise.race([
				connection.request(method, params, options.signal),
				connection.closed.then(() => Promise.reject(new GooseConnectionLostError())),
			]),
			method,
			options,
		);
	}
	async #notify(
		method: string,
		params: Record<string, unknown>,
		options: GooseRequestOptions = {},
	): Promise<void> {
		await this.ready(options);
		if (
			options.connectionGeneration !== undefined &&
			this.connectionGeneration !== options.connectionGeneration
		) {
			throw new GooseConnectionLostError("Goose ACP connection generation changed");
		}
		const connection = this.#connection;
		if (!connection) throw new GooseConnectionLostError();
		return this.#withBounds(
			Promise.race([
				connection.notify(method, params, options.signal),
				connection.closed.then(() => Promise.reject(new GooseConnectionLostError())),
			]),
			method,
			options,
		);
	}
	#withBounds<T>(promise: Promise<T>, operation: string, options: GooseRequestOptions): Promise<T> {
		if (options.signal?.aborted)
			return Promise.reject(options.signal.reason ?? new Error("aborted"));
		const timeoutMs = options.timeoutMs ?? this.#options.timeoutMs;
		if (options.timeoutMs === null) return withAbort(promise, options.signal);
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new GooseTimeoutError(operation, timeoutMs)),
				timeoutMs,
			);
			timer.unref?.();
			const abort = () => reject(options.signal?.reason ?? new Error("aborted"));
			options.signal?.addEventListener("abort", abort, { once: true });
			promise.then(resolve, reject).finally(() => {
				clearTimeout(timer);
				options.signal?.removeEventListener("abort", abort);
			});
		});
	}
	#dropConnection(): void {
		const old = this.#connection;
		this.#connection = undefined;
		this.#ready = undefined;
		this.#readyGeneration = undefined;
		old?.close();
		if (!this.#closed) this.#emit({ type: "disconnected" });
	}
	#emit(event: GooseClientEvent): void {
		for (const listener of this.#listeners) {
			try {
				listener(event);
			} catch (error) {
				this.#emitProtocolError(error);
			}
		}
	}
	#emitProtocolError(error: unknown): void {
		for (const listener of this.#listeners) {
			try {
				listener({ type: "protocol-error", error: asError(error) });
			} catch {}
		}
	}
	#emitUpdate(update: GooseUpdate): void {
		this.#emit({ type: "update", update });
	}
	#onGooseNotification(method: string, params: unknown): void {
		if (method === "_goose/unstable/session/update") this.#emitUpdate(normalizeGooseUpdate(params));
		else if (method === "_goose/unstable/providers/authentication/device-code") {
			const p = object(params);
			this.#emit({
				type: "provider-device-code",
				providerId: requiredString(p, "providerId"),
				userCode: requiredString(p, "userCode"),
				verificationUri: requiredString(p, "verificationUri"),
				expiresIn: number(p.expiresIn) ?? 0,
			});
		}
	}
	async #onPermission(params: unknown, signal: AbortSignal): Promise<unknown> {
		const request = normalizePermission(params);
		const decision: GoosePermissionDecision = this.#options.permissionHandler
			? await this.#options.permissionHandler(request, signal)
			: "cancelled";
		if (decision === "cancelled") return { outcome: { outcome: "cancelled" } };
		const selected = request.options.find((option) => option.optionId === decision.optionId);
		if (!selected) return { outcome: { outcome: "cancelled" } };
		return { outcome: { outcome: "selected", optionId: selected.optionId } };
	}
}

function webSocketConnectionFactory(url: string, secretKey?: string): GooseConnectionFactory {
	return {
		async connect(handlers) {
			const { default: WebSocket } = await loadNodeWebSocket();
			const stream = createWebSocketStream(url, {
				WebSocket,
				...(secretKey ? { headers: { "X-Secret-Key": secretKey } } : {}),
			});
			const permissionAbort = new AbortController();
			const sdkClient: acp.Client = {
				sessionUpdate: (params: unknown) => handlers.onSessionUpdate(params),
				requestPermission: (params: unknown) =>
					handlers.onPermission(
						params,
						permissionAbort.signal,
					) as Promise<acp.RequestPermissionResponse>,
				extNotification: (method: string, params: Record<string, unknown>) =>
					handlers.onGooseNotification(method, params),
			};
			const sdk = new acp.ClientSideConnection(() => sdkClient, stream);
			void sdk.closed.then(() => permissionAbort.abort());
			return new SdkConnection(sdk, () => {
				permissionAbort.abort();
				void stream.writable.abort().catch(() => {});
				void stream.readable.cancel().catch(() => {});
			});
		},
	};
}

class SdkConnection implements GooseConnection {
	readonly #sdk: acp.ClientSideConnection;
	readonly #close;
	constructor(sdk: acp.ClientSideConnection, close: () => void) {
		this.#sdk = sdk;
		this.#close = close;
	}
	get closed(): Promise<void> {
		return this.#sdk.closed;
	}
	close(): void {
		this.#close();
	}
	async request(
		method: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (signal?.aborted) throw signal.reason ?? new Error("aborted");
		switch (method) {
			case "initialize":
				return this.#sdk.initialize(params as acp.InitializeRequest);
			case "session/new":
				return this.#sdk.newSession(params as acp.NewSessionRequest);
			case "session/load":
				return this.#sdk.loadSession(params as acp.LoadSessionRequest);
			case "session/list":
				return this.#sdk.listSessions(params as acp.ListSessionsRequest);
			case "session/delete":
				return this.#sdk.deleteSession(params as acp.DeleteSessionRequest);
			case "session/fork":
				return this.#sdk.unstable_forkSession(params as acp.ForkSessionRequest);
			case "session/prompt":
				return this.#sdk.prompt(params as acp.PromptRequest);
			case "session/set_config_option":
				return this.#sdk.setSessionConfigOption(params as acp.SetSessionConfigOptionRequest);
			default:
				return this.#sdk.request(method, params);
		}
	}
	async notify(
		method: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<void> {
		if (signal?.aborted) throw signal.reason ?? new Error("aborted");
		if (method === "session/cancel") return this.#sdk.cancel(params as acp.CancelNotification);
		return this.#sdk.notify(method, params);
	}
}

function object(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}
function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}
function string(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}
function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function requiredString(value: unknown, key: string): string {
	const result = string(object(value)[key]);
	if (!result) throw new Error(`Goose response is missing ${key}`);
	return result;
}
function raw(value: unknown): JsonValue {
	return value as JsonValue;
}
function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}
export function isGooseResourceNotFound(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === -32002
	);
}
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason ?? new Error("aborted"));
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}
function normalizeSession(value: unknown): GooseSession {
	const p = object(value);
	const meta = object(p._meta);
	const cwd = string(p.cwd);
	const title = string(p.title);
	const updatedAt = string(p.updatedAt);
	const createdAt = string(p.createdAt) ?? string(meta.createdAt);
	const projectId = string(p.projectId) ?? string(meta.projectId);
	const messageCount = number(p.messageCount) ?? number(meta.messageCount);
	const archivedAt = string(p.archivedAt) ?? string(meta.archivedAt);
	const archived = typeof p.archived === "boolean" ? p.archived : archivedAt !== undefined;
	return {
		sessionId: requiredString(p, "sessionId"),
		...(cwd === undefined ? {} : { cwd }),
		...(title === undefined ? {} : { title }),
		...(updatedAt === undefined ? {} : { updatedAt }),
		...(createdAt === undefined ? {} : { createdAt }),
		...(projectId === undefined ? {} : { projectId }),
		...(messageCount === undefined ? {} : { messageCount }),
		...(archivedAt === undefined ? {} : { archivedAt }),
		archived,
		raw: raw(value),
	};
}
function normalizeModel(value: unknown): GooseModel {
	const p = object(value);
	const name = string(p.name) ?? requiredString(p, "id");
	const providerId = string(p.providerId);
	const family = string(p.family);
	const contextLimit = number(p.contextLimit);
	const modalities = array(p.modalities ?? p.input).filter(
		(x): x is string => typeof x === "string",
	);
	return {
		id: requiredString(p, "id"),
		name,
		...(providerId === undefined ? {} : { providerId }),
		...(family === undefined ? {} : { family }),
		...(contextLimit === undefined ? {} : { contextLimit }),
		...(typeof p.reasoning === "boolean" ? { reasoning: p.reasoning } : {}),
		...(typeof p.recommended === "boolean" ? { recommended: p.recommended } : {}),
		...(modalities.length ? { modalities } : {}),
		raw: raw(value),
	};
}
function normalizeProvider(value: unknown): GooseProvider {
	const p = object(value);
	const name = string(p.providerName ?? p.name) ?? requiredString(p, "providerId");
	const description = string(p.description);
	const defaultModel = string(p.defaultModel);
	const lastRefreshError = string(p.lastRefreshError);
	return {
		id: requiredString(p, "providerId"),
		name,
		...(description === undefined ? {} : { description }),
		...(typeof p.configured === "boolean" ? { configured: p.configured } : {}),
		...(typeof p.available === "boolean" ? { available: p.available } : {}),
		...(defaultModel === undefined ? {} : { defaultModel }),
		...(typeof p.supportsRefresh === "boolean" ? { supportsRefresh: p.supportsRefresh } : {}),
		...(typeof p.refreshing === "boolean" ? { refreshing: p.refreshing } : {}),
		...(typeof p.visibleInSetup === "boolean" ? { visibleInSetup: p.visibleInSetup } : {}),
		...(typeof p.deprecated === "boolean" ? { deprecated: p.deprecated } : {}),
		...(lastRefreshError === undefined ? {} : { lastRefreshError }),
		configKeys: array(p.configKeys).map((candidate) => {
			const key = object(candidate);
			const defaultValue = string(key.default);
			return {
				name: requiredString(key, "name"),
				required: key.required === true,
				secret: key.secret === true,
				...(defaultValue === undefined ? {} : { defaultValue }),
				oauthFlow: key.oauthFlow === true,
				deviceCodeFlow: key.deviceCodeFlow === true,
				primary: key.primary === true,
			};
		}),
		setupSteps: array(p.setupSteps).filter((step): step is string => typeof step === "string"),
		models: array(p.models).map(normalizeModel),
		raw: raw(value),
	};
}
function normalizeProviderConfigField(value: unknown): GooseProviderConfigField {
	const p = object(value);
	const fieldValue = string(p.value);
	return {
		key: requiredString(p, "key"),
		...(fieldValue === undefined ? {} : { value: fieldValue }),
		isSet: p.isSet === true,
		isSecret: p.isSecret === true,
		required: p.required === true,
	};
}
function normalizeConfigOptions(value: unknown): GooseConfigOption[] {
	return array(value).map((item) => {
		const p = object(item);
		const name = string(p.name);
		const description = string(p.description);
		const currentValue =
			typeof p.currentValue === "string" || typeof p.currentValue === "boolean"
				? p.currentValue
				: undefined;
		const values = array(p.options ?? p.values).flatMap((candidate) => {
			const option = object(candidate);
			return Array.isArray(option.options) ? option.options : [candidate];
		});
		return {
			id: requiredString(p, "id"),
			...(name === undefined ? {} : { name }),
			...(description === undefined ? {} : { description }),
			...(currentValue === undefined ? {} : { currentValue }),
			values: values.map((v) => {
				const o = object(v);
				const optionName = string(o.name);
				return {
					value: requiredString(o, "value"),
					...(optionName === undefined ? {} : { name: optionName }),
				};
			}),
			raw: raw(item),
		};
	});
}
function normalizeSessionInfo(value: unknown, fallbackSessionId: string): GooseSessionInfo {
	const p = object(value);
	const sessionValue = p.session ?? { sessionId: p.sessionId ?? fallbackSessionId, _meta: p._meta };
	const configOptions = normalizeConfigOptions(p.configOptions);
	const providerId =
		configSelection(configOptions, "provider") ?? selectionFromMeta(p._meta, "providerId");
	const modelId = configSelection(configOptions, "model") ?? selectionFromMeta(p._meta, "modelId");
	const thinkingEffort =
		configSelection(configOptions, "thinking_effort") ??
		selectionFromMeta(p._meta, "thinkingEffort");
	return {
		session: normalizeSession(sessionValue),
		...(providerId === undefined ? {} : { providerId }),
		...(modelId === undefined ? {} : { modelId }),
		...(thinkingEffort === undefined ? {} : { thinkingEffort }),
		configOptions,
		raw: raw(value),
	};
}
function normalizeRecipeListEntry(value: unknown): GooseRecipeListEntry {
	const p = object(value);
	const scheduleCron = string(p.schedule_cron);
	const slashCommand = string(p.slash_command);
	return {
		id: requiredString(p, "id"),
		recipe: normalizeRecipe(p.recipe),
		filePath: requiredString(p, "file_path"),
		lastModified: requiredString(p, "last_modified"),
		...(scheduleCron === undefined ? {} : { scheduleCron }),
		...(slashCommand === undefined ? {} : { slashCommand }),
		raw: raw(value),
	};
}
function configSelection(options: readonly GooseConfigOption[], id: string): string | undefined {
	const value = options.find((option) => option.id === id)?.currentValue;
	return typeof value === "string" ? value : undefined;
}
function selectionFromMeta(value: unknown, key: string): string | undefined {
	const meta = object(value);
	return string(meta[key]) ?? string(object(meta.goose)[key]);
}
function normalizeRecipe(value: unknown): GooseRecipe {
	const p = object(value);
	const id = string(p.id);
	const version = string(p.version);
	const instructions = string(p.instructions);
	const prompt = string(p.prompt);
	return {
		...(p as Record<string, JsonValue>),
		...(id === undefined ? {} : { id }),
		...(version === undefined ? {} : { version }),
		title: string(p.title) ?? "",
		description: string(p.description) ?? "",
		...(instructions === undefined ? {} : { instructions }),
		...(prompt === undefined ? {} : { prompt }),
	};
}
function normalizeSchedule(value: unknown): GooseSchedule {
	const p = object(value);
	const lastRun = string(p.lastRun);
	const currentSessionId = string(p.currentSessionId);
	const jobStartTime = string(p.jobStartTime);
	return {
		id: requiredString(p, "id"),
		source: requiredString(p, "source"),
		cron: requiredString(p, "cron"),
		...(lastRun === undefined ? {} : { lastRun }),
		currentlyRunning: p.currentlyRunning === true,
		paused: p.paused === true,
		...(currentSessionId === undefined ? {} : { currentSessionId }),
		...(jobStartTime === undefined ? {} : { jobStartTime }),
		raw: raw(value),
	};
}
function normalizeScheduledJobInspection(value: unknown): GooseScheduledJobInspection {
	const p = object(value);
	const sessionId = string(p.sessionId);
	const jobStartTime = string(p.jobStartTime);
	const runningDurationSeconds = number(p.runningDurationSeconds);
	return {
		running: p.running === true,
		...(sessionId === undefined ? {} : { sessionId }),
		...(jobStartTime === undefined ? {} : { jobStartTime }),
		...(runningDurationSeconds === undefined ? {} : { runningDurationSeconds }),
	};
}
function normalizeSlashCommand(value: unknown): GooseSlashCommand {
	const p = object(value);
	const description = string(p.description);
	const input = object(p.input);
	const inputHint = string(input.hint ?? input.inputHint);
	return {
		name: requiredString(p, "name"),
		...(description === undefined ? {} : { description }),
		...(inputHint === undefined ? {} : { inputHint }),
		raw: raw(value),
	};
}
function normalizeTool(value: unknown): GooseTool {
	const p = object(value);
	const permission = normalizeToolPermission(p.permission);
	if (p.permission != null && permission === undefined) {
		throw new Error("Unknown Goose tool permission");
	}
	return {
		name: requiredString(p, "name"),
		description: string(p.description) ?? "",
		parameters: array(p.parameters).filter((x): x is string => typeof x === "string"),
		...(permission === undefined ? {} : { permission }),
		inputSchema: raw(p.inputSchema),
		...(p.outputSchema !== undefined ? { outputSchema: raw(p.outputSchema) } : {}),
	};
}
export function normalizeToolPermission(value: unknown): GooseToolPermission | undefined {
	return value === "always_allow" || value === "ask_before" || value === "never_allow"
		? value
		: undefined;
}
function normalizeExtension(value: unknown): GooseExtension {
	const p = object(value);
	const type = requiredExtensionType(p.type);
	const server = object(p.server);
	const displayName = string(p.displayName) ?? string(p.display_name);
	const description = string(p.description);
	const availableTools = array(p.availableTools ?? p.available_tools).filter(
		(tool): tool is string => typeof tool === "string",
	);
	return {
		name:
			type === "mcp"
				? requiredExtensionIdentifier(server, "name")
				: requiredExtensionIdentifier(p, "name"),
		type,
		...(displayName === undefined ? {} : { displayName }),
		...(description === undefined ? {} : { description }),
		...(typeof p.bundled === "boolean" ? { bundled: p.bundled } : {}),
		...(availableTools.length ? { availableTools } : {}),
		raw: raw(value),
	};
}
function normalizeConfiguredExtension(value: unknown): GooseConfiguredExtension {
	const p = object(value);
	if (typeof p.enabled !== "boolean")
		throw new Error("Goose configured extension is missing enabled");
	const configKey = string(p.configKey);
	if (configKey !== undefined && (!configKey || configKey.includes("\0"))) {
		throw new Error("Goose configured extension has an invalid configKey");
	}
	return {
		...normalizeExtension(p.extension),
		enabled: p.enabled,
		...(configKey === undefined ? {} : { configKey }),
	};
}
function requiredExtensionType(value: unknown): GooseExtension["type"] {
	if (value === "builtin" || value === "platform" || value === "mcp") return value;
	throw new Error("Goose extension is missing a supported type");
}
function requiredExtensionIdentifier(value: unknown, key: string): string {
	const identifier = requiredString(value, key);
	if (identifier.includes("\0")) throw new Error(`Goose extension has an invalid ${key}`);
	return identifier;
}
function normalizeUsage(value: unknown): GooseUsage {
	const p = object(value);
	const inputTokens = number(p.inputTokens);
	const outputTokens = number(p.outputTokens);
	const totalTokens = number(p.totalTokens);
	const cacheReadTokens = number(p.cacheReadTokens);
	const cacheWriteTokens = number(p.cacheWriteTokens);
	const cost = number(p.cost);
	const costSource = string(p.costSource);
	const elapsedMs = number(p.elapsedMs);
	const timeToFirstTokenMs = number(p.timeToFirstTokenMs);
	return {
		...(inputTokens === undefined ? {} : { inputTokens }),
		...(outputTokens === undefined ? {} : { outputTokens }),
		...(totalTokens === undefined ? {} : { totalTokens }),
		...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
		...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
		...(cost === undefined ? {} : { cost }),
		...(costSource === undefined ? {} : { costSource }),
		...(elapsedMs === undefined ? {} : { elapsedMs }),
		...(timeToFirstTokenMs === undefined ? {} : { timeToFirstTokenMs }),
		...(typeof p.isCompaction === "boolean" ? { isCompaction: p.isCompaction } : {}),
	};
}
function normalizeStandardUpdate(value: unknown): GooseUpdate {
	const notification = object(value);
	const sessionId = requiredString(notification, "sessionId");
	const p = object(notification.update);
	const type = string(p.sessionUpdate) ?? "unknown";
	const rawValue = raw(value);
	if (type === "agent_message_chunk" || type === "user_message_chunk") {
		const messageId = string(p.messageId);
		const role = type === "user_message_chunk" ? "user" : "assistant";
		const content = object(p.content);
		if (string(content.type) === "image") {
			const data = string(content.data);
			const mimeType = string(content.mimeType);
			if (data !== undefined && mimeType !== undefined)
				return {
					type: "image",
					sessionId,
					role,
					...(messageId === undefined ? {} : { messageId }),
					image: { data, mimeType },
					raw: rawValue,
				};
		}
		const text = string(content.text);
		if (string(content.type) === "text" || text !== undefined)
			return {
				type: "text",
				sessionId,
				role,
				...(messageId === undefined ? {} : { messageId }),
				text: text ?? "",
				raw: rawValue,
			};
	}
	if (type === "agent_thought_chunk") {
		const messageId = string(p.messageId);
		return {
			type: "thinking",
			sessionId,
			...(messageId === undefined ? {} : { messageId }),
			text: string(object(p.content).text) ?? "",
			raw: rawValue,
		};
	}
	if (type === "tool_call") {
		const toolName = string(object(object(object(p._meta).goose).toolCall).toolName);
		const title = string(p.title);
		const kind = string(p.kind);
		return {
			type: "tool-call",
			sessionId,
			toolCallId: requiredString(p, "toolCallId"),
			...(toolName === undefined ? {} : { toolName }),
			...(title === undefined ? {} : { title }),
			...(kind === undefined ? {} : { kind }),
			...(Array.isArray(p.content) ? { content: p.content.map(raw) } : {}),
			...(Array.isArray(p.locations) ? { locations: p.locations.map(raw) } : {}),
			...(hasOwn(p, "rawInput") ? { rawInput: raw(p.rawInput) } : {}),
			raw: rawValue,
		};
	}
	if (type === "tool_call_update") {
		const status = string(p.status);
		return {
			type: "tool-update",
			sessionId,
			toolCallId: requiredString(p, "toolCallId"),
			...(status === undefined ? {} : { status }),
			...(Array.isArray(p.content) ? { content: p.content.map(raw) } : {}),
			...(hasOwn(p, "error") ? { error: raw(p.error) } : {}),
			...(hasOwn(p, "rawOutput") ? { rawOutput: raw(p.rawOutput) } : {}),
			raw: rawValue,
		};
	}
	if (type === "config_option_update")
		return {
			type: "config",
			sessionId,
			configOptions: normalizeConfigOptions(p.configOptions),
			raw: rawValue,
		};
	if (type === "session_info_update") {
		const activeRunId = gooseMetaValue(p._meta, "activeRunId");
		return {
			type: "session-info",
			sessionId,
			session: normalizeSession({ sessionId, ...p }),
			...(activeRunId === undefined ? {} : { activeRunId }),
			raw: rawValue,
		};
	}
	return { type: "unknown", sessionId, updateType: type, raw: rawValue };
}
function normalizeGooseUpdate(value: unknown): GooseUpdate {
	const p = object(value);
	const sessionId = requiredString(p, "sessionId");
	const update = object(p.update);
	const type = string(update.sessionUpdate) ?? "unknown";
	if (type === "usage_update") {
		const accumulatedCost = number(update.accumulatedCost);
		const usage: GooseContextUsage = {
			used: number(update.used) ?? 0,
			contextLimit: number(update.contextLimit) ?? 0,
			accumulatedInputTokens: number(update.accumulatedInputTokens) ?? 0,
			accumulatedOutputTokens: number(update.accumulatedOutputTokens) ?? 0,
			...(accumulatedCost === undefined ? {} : { accumulatedCost }),
		};
		return { type: "context-usage", sessionId, usage, raw: raw(value) };
	}
	if (type === "message_usage") {
		const messageId = string(update.messageId);
		return {
			type: "usage",
			sessionId,
			...(messageId === undefined ? {} : { messageId }),
			usage: normalizeUsage(update.usage),
			raw: raw(value),
		};
	}
	if (type === "status_message") {
		const status = object(update.status);
		return {
			type: "status",
			sessionId,
			status: string(status.type) ?? "notice",
			message: string(status.message) ?? "",
			raw: raw(value),
		};
	}
	return { type: "unknown", sessionId, updateType: type, raw: raw(value) };
}
function normalizePermission(value: unknown): GoosePermissionRequest {
	const p = object(value);
	const tool = object(p.toolCall);
	const title = string(tool.title);
	const kind = string(tool.kind);
	return {
		sessionId: requiredString(p, "sessionId"),
		toolCall: {
			toolCallId: requiredString(tool, "toolCallId"),
			...(title === undefined ? {} : { title }),
			...(kind === undefined ? {} : { kind }),
			raw: raw(tool),
		},
		options: array(p.options).map((item) => {
			const option = object(item);
			return {
				optionId: requiredString(option, "optionId"),
				name: string(option.name) ?? "",
				kind: string(option.kind) ?? "",
				raw: raw(item),
			};
		}),
	};
}
function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.hasOwn(value, key);
}
function gooseMetaValue(value: unknown, key: string): string | null | undefined {
	const candidate = object(object(value).goose)[key];
	return typeof candidate === "string" || candidate === null ? candidate : undefined;
}
