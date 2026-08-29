import { createHash, randomUUID } from "node:crypto";
import { join, normalize } from "node:path";
import type {
	ProjectFsChangedPayload,
	ServerWelcome,
	SessionDeletedPayload,
} from "@gooseberry/contracts";
import {
	isCodeToken,
	MAX_SERIALIZED_WS_REQUEST_BYTES,
	PROTOCOL_VERSION,
	WS_CHANNELS,
} from "@gooseberry/contracts";
import { errorCodeOf } from "@gooseberry/shared/codedError";
import {
	currentGooseStatus,
	disposeAllSessions,
	pendingPermissionSnapshot,
	providerLoginSnapshot,
	refreshGooseStatus,
	sessionForObjectiveToken,
	setObjectiveMcpUrl,
	setPermissionPublisher,
	setPermissionResolvedPublisher,
	setProviderLoginPublisher,
	setSessionDeletedPublisher,
	setSessionLifecyclePublisher,
	setSessionPublisher,
} from "../agent";
import { ControllerAuth, expiredSessionCookie, sessionCookie } from "../auth";
import { resolveProjectFile } from "../fs";
import { sessionGoalState, updateStoredSessionObjective } from "../persistence";
import { getProject, listProjects, listRecentProjects, setProjectPublisher } from "../projects";
import { getConfig, setSettingsPublisher } from "../settings";
import { setWatchPublisher, stopAllWatches } from "../watch";
import { handleRequest } from "./handlers";
import { createObjectiveMcpHandler } from "./objective-mcp";
import { RequestReplayCache } from "./request-replay-cache";
import {
	authorizeWebSocketUpgrade,
	isAuthorizedHttpRequest,
	isExpectedOrigin,
	isSecureRequest,
	readAuthCookie,
	readWebSocketAuthConfig,
	validateAuthTokens,
} from "./web-socket-auth";

export interface CreateServerOptions {
	/** Explicit embedding and test seam. Production always uses the fixed runtime endpoint. */
	port?: number;
	/** Explicit embedding and test seam. Production always uses the fixed runtime endpoint. */
	host?: string;
	appVersion?: string;
	/** Test and embedding hook for an already initialized controller auth store. */
	controllerAuth?: ControllerAuth;
}

export interface RunningServer {
	readonly port: number;
	stop: () => void;
}

interface SocketData {
	clientKey: string;
	sessionExpiresAt: number | undefined;
}

const CLIENT_REPLAY_RETENTION_MS = 60_000;
const BROWSER_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
const BROWSER_ARTIFACT_TIMEOUT_MS = 30_000;
const BROWSER_ARTIFACT_PATH = /^\/v1\/artifacts\/([^/]+)\/([^/]+)$/;
const BROWSER_SESSION = /^[A-Za-z0-9_-]{1,38}$/;
const BROWSER_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.(?:png|jpe?g|webp)$/i;
const BROWSER_ARTIFACT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CLIENT_KEY = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_AUTH_BODY_BYTES = 4096;
const MAX_TIMEOUT_MS = 2_147_483_647;
export const CONTROLLER_HOST = "0.0.0.0";
export const CONTROLLER_PORT = 7312;
export const CONTROLLER_STATIC_DIR = "/app/web";
const BROWSER_SERVICE_URL = new URL("http://127.0.0.1:8787");

/** Bun delivers text as strings and binary frames as byte arrays. Count wire bytes in both cases. */
export function isWebSocketPayloadWithinLimit(message: string | Uint8Array): boolean {
	return (
		(typeof message === "string" ? Buffer.byteLength(message) : message.byteLength) <=
		MAX_SERIALIZED_WS_REQUEST_BYTES
	);
}

interface BrowserArtifactTarget {
	session: string;
	name: string;
	path: string;
}

function browserArtifactTarget(pathname: string): BrowserArtifactTarget | undefined {
	const match = BROWSER_ARTIFACT_PATH.exec(pathname);
	if (!match) return undefined;
	let session: string;
	let name: string;
	try {
		session = decodeURIComponent(match[1] as string);
		name = decodeURIComponent(match[2] as string);
	} catch {
		return undefined;
	}
	if (!BROWSER_SESSION.test(session) || !BROWSER_ARTIFACT_NAME.test(name)) return undefined;
	return {
		session,
		name,
		path: `/v1/artifacts/${encodeURIComponent(session)}/${encodeURIComponent(name)}`,
	};
}

function authResponse(body: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set("cache-control", "no-store");
	headers.set("content-type", "application/json; charset=utf-8");
	return new Response(JSON.stringify(body), { ...init, headers });
}

function isSameOriginMutation(
	req: Request,
	websocketAuth: ReturnType<typeof readWebSocketAuthConfig>,
): boolean {
	return (
		req.headers.get("sec-fetch-site") === "same-origin" && isExpectedOrigin(req, websocketAuth)
	);
}

async function readAuthJson(req: Request): Promise<Record<string, unknown> | Response> {
	if (req.headers.get("content-type") !== "application/json") {
		return authResponse({ error: "unsupported media type" }, { status: 415 });
	}
	const length = req.headers.get("content-length");
	if (length && (!/^\d+$/.test(length) || Number(length) > MAX_AUTH_BODY_BYTES)) {
		return authResponse({ error: "request too large" }, { status: 413 });
	}
	const reader = req.body?.getReader();
	if (!reader) return authResponse({ error: "invalid request" }, { status: 400 });
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_AUTH_BODY_BYTES) {
				await reader.cancel();
				return authResponse({ error: "request too large" }, { status: 413 });
			}
			chunks.push(value);
		}
	} catch {
		return authResponse({ error: "invalid request" }, { status: 400 });
	}
	try {
		const text = new TextDecoder().decode(Buffer.concat(chunks));
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: authResponse({ error: "invalid request" }, { status: 400 });
	} catch {
		return authResponse({ error: "invalid request" }, { status: 400 });
	}
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

async function handleControllerAuth(
	req: Request,
	url: URL,
	auth: ControllerAuth | undefined,
	websocketAuth: ReturnType<typeof readWebSocketAuthConfig>,
): Promise<Response> {
	if (url.pathname === "/auth/status") {
		if (req.method !== "GET")
			return authResponse(
				{ error: "method not allowed" },
				{ status: 405, headers: { allow: "GET" } },
			);
		return authResponse(
			websocketAuth.authenticationEnabled
				? {
						authenticationEnabled: true,
						authenticated: auth?.isSession(readAuthCookie(req)) === true,
					}
				: { authenticationEnabled: false, authenticated: true },
		);
	}
	if (!["/auth/login", "/auth/logout"].includes(url.pathname)) {
		return authResponse({ error: "not found" }, { status: 404 });
	}
	if (!websocketAuth.authenticationEnabled) {
		return authResponse({ error: "not found" }, { status: 404 });
	}
	if (!auth) throw new Error("GOOSEBERRY_TOKEN authentication is not configured");
	if (req.method !== "POST")
		return authResponse(
			{ error: "method not allowed" },
			{ status: 405, headers: { allow: "POST" } },
		);
	if (!isSameOriginMutation(req, websocketAuth))
		return authResponse({ error: "forbidden" }, { status: 403 });
	const body = await readAuthJson(req);
	if (body instanceof Response) return body;
	const secure = isSecureRequest(req, websocketAuth);
	if (url.pathname === "/auth/login") {
		if (!hasExactKeys(body, ["token"]) || typeof body.token !== "string")
			return authResponse({ error: "invalid request" }, { status: 400 });
		const session = auth.login(body.token);
		if (!session) return authResponse({ error: "authentication failed" }, { status: 401 });
		return authResponse(
			{ authenticated: true },
			{ headers: { "set-cookie": sessionCookie(session, secure, auth.maxAgeSeconds) } },
		);
	}
	if (url.pathname === "/auth/logout") {
		if (!hasExactKeys(body, [])) return authResponse({ error: "invalid request" }, { status: 400 });
		return authResponse(
			{ authenticated: false },
			{ headers: { "set-cookie": expiredSessionCookie(secure) } },
		);
	}
	return authResponse({ error: "not found" }, { status: 404 });
}

async function proxyBrowserArtifact(pathname: string): Promise<Response> {
	const target = browserArtifactTarget(pathname);
	if (!target) return new Response("not found", { status: 404 });

	const tokens = validateAuthTokens();
	const token = tokens.browserToken;
	if (tokens.browserAuthenticationEnabled && !isCodeToken(token))
		return new Response("browser artifact proxy unavailable", { status: 503 });

	let upstream: Response;
	try {
		upstream = await fetch(new URL(target.path, BROWSER_SERVICE_URL), {
			...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
			redirect: "error",
			signal: AbortSignal.timeout(BROWSER_ARTIFACT_TIMEOUT_MS),
		});
	} catch {
		return new Response("browser artifact proxy unavailable", { status: 502 });
	}

	if (!upstream.ok) return new Response("not found", { status: 404 });
	const contentType = upstream.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
	const contentLengthHeader = upstream.headers.get("content-length");
	const contentLength = contentLengthHeader === null ? NaN : Number(contentLengthHeader);
	if (
		!contentType ||
		!BROWSER_ARTIFACT_TYPES.has(contentType) ||
		!Number.isSafeInteger(contentLength) ||
		contentLength < 0 ||
		contentLength > BROWSER_ARTIFACT_MAX_BYTES ||
		!upstream.body
	) {
		return new Response("invalid browser artifact", { status: 502 });
	}

	return new Response(upstream.body, {
		status: 200,
		headers: {
			"content-type": contentType,
			"content-length": String(contentLength),
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
}

const isRequestId = (id: unknown): id is string => typeof id === "string";

export async function createServer(options: CreateServerOptions = {}): Promise<RunningServer> {
	const {
		port = CONTROLLER_PORT,
		host = CONTROLLER_HOST,
		appVersion,
		controllerAuth: suppliedAuth,
	} = options;
	const tokens = validateAuthTokens();
	let controllerAuth = suppliedAuth;
	if (!controllerAuth && tokens.authenticationEnabled) {
		if (!tokens.controllerToken)
			throw new Error("GOOSEBERRY_TOKEN authentication is not configured");
		controllerAuth = new ControllerAuth({
			token: tokens.controllerToken,
		});
	}
	const websocketAuth = readWebSocketAuthConfig(controllerAuth);

	const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>();
	const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const socketExpiryTimers = new Map<
		Bun.ServerWebSocket<SocketData>,
		ReturnType<typeof setTimeout>
	>();
	const requestReplays = new RequestReplayCache<string>();
	let stopping = false;

	const clearSocketExpiry = (ws: Bun.ServerWebSocket<SocketData>): void => {
		const timer = socketExpiryTimers.get(ws);
		if (timer !== undefined) clearTimeout(timer);
		socketExpiryTimers.delete(ws);
	};

	const isSocketSessionActive = (ws: Bun.ServerWebSocket<SocketData>): boolean =>
		ws.data.sessionExpiresAt === undefined || ws.data.sessionExpiresAt > Date.now();

	const armSocketExpiry = (ws: Bun.ServerWebSocket<SocketData>): void => {
		clearSocketExpiry(ws);
		if (ws.data.sessionExpiresAt === undefined) return;
		const remaining = ws.data.sessionExpiresAt - Date.now();
		if (remaining <= 0) {
			ws.close(1008, "authentication expired");
			return;
		}
		socketExpiryTimers.set(
			ws,
			setTimeout(
				() => {
					socketExpiryTimers.delete(ws);
					if (isSocketSessionActive(ws)) armSocketExpiry(ws);
					else ws.close(1008, "authentication expired");
				},
				Math.min(remaining, MAX_TIMEOUT_MS),
			),
		);
	};

	const armClientReap = (clientKey: string): void => {
		reapTimers.set(
			clientKey,
			setTimeout(() => {
				reapTimers.delete(clientKey);
				if (sockets.has(clientKey)) return;
				if (!requestReplays.clearClient(clientKey)) armClientReap(clientKey);
			}, CLIENT_REPLAY_RETENTION_MS),
		);
	};

	const publishToSockets = (channel: string, data: unknown): void => {
		const message = JSON.stringify({ channel, data });
		for (const ws of sockets.values()) {
			if (!isSocketSessionActive(ws)) {
				ws.close(1008, "authentication expired");
				continue;
			}
			if (ws.send(message) === 0) ws.close();
		}
	};
	const publishToClient = (clientKey: string, channel: string, data: unknown): void => {
		const ws = sockets.get(clientKey);
		if (!ws) return;
		if (!isSocketSessionActive(ws)) {
			ws.close(1008, "authentication expired");
			return;
		}
		if (ws.send(JSON.stringify({ channel, data })) === 0) ws.close();
	};
	const objectiveMcp = createObjectiveMcpHandler({
		sessionForToken: sessionForObjectiveToken,
		readObjective: sessionGoalState,
		updateObjective: updateStoredSessionObjective,
	});

	const server = Bun.serve<SocketData, never>({
		port,
		hostname: host,
		async fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/mcp/objective") return objectiveMcp(req);
			if (url.pathname.startsWith("/auth/"))
				return handleControllerAuth(req, url, controllerAuth, websocketAuth);
			if (url.pathname === "/ws") {
				const authorization = authorizeWebSocketUpgrade(req, websocketAuth);
				if (authorization instanceof Response) return authorization;
				const requestedClientKey = url.searchParams.get("client");
				const clientKey =
					requestedClientKey && CLIENT_KEY.test(requestedClientKey)
						? requestedClientKey
						: `anon-${randomUUID()}`;
				return srv.upgrade(req, {
					data: { clientKey, sessionExpiresAt: authorization.sessionExpiresAt },
				})
					? undefined
					: new Response("ws upgrade failed", { status: 400 });
			}
			if (url.pathname === "/health") {
				return new Response("ok");
			}
			if (url.pathname.startsWith("/v1/artifacts/")) {
				if (!isAuthorizedHttpRequest(req, websocketAuth))
					return new Response("unauthorized", { status: 401 });
				if (req.method !== "GET") {
					return new Response("method not allowed", {
						status: 405,
						headers: { allow: "GET" },
					});
				}
				return proxyBrowserArtifact(url.pathname);
			}
			if (url.pathname.startsWith("/files/")) {
				if (!isAuthorizedHttpRequest(req, websocketAuth))
					return new Response("unauthorized", { status: 401 });
				if (req.method !== "GET") {
					return new Response("method not allowed", {
						status: 405,
						headers: { allow: "GET" },
					});
				}
				return serveProjectFile(url.pathname);
			}
			return serveStatic(url.pathname, CONTROLLER_STATIC_DIR);
		},
		websocket: {
			maxPayloadLength: MAX_SERIALIZED_WS_REQUEST_BYTES,
			open(ws) {
				const replaced = sockets.get(ws.data.clientKey);
				sockets.set(ws.data.clientKey, ws);
				if (replaced && replaced !== ws) {
					clearSocketExpiry(replaced);
					replaced.close();
				}
				const pendingReap = reapTimers.get(ws.data.clientKey);
				if (pendingReap !== undefined) {
					clearTimeout(pendingReap);
					reapTimers.delete(ws.data.clientKey);
				}
				if (!isSocketSessionActive(ws)) {
					ws.close(1008, "authentication expired");
					return;
				}
				armSocketExpiry(ws);
				ws.subscribe(WS_CHANNELS.agentEvent);
				ws.subscribe(WS_CHANNELS.sessionDeleted);
				ws.subscribe(WS_CHANNELS.sessionLifecycleChanged);
				ws.subscribe(WS_CHANNELS.providerLogin);
				ws.subscribe(WS_CHANNELS.projectUpdated);
				ws.subscribe(WS_CHANNELS.projectFsChanged);
				ws.subscribe(WS_CHANNELS.settingsChanged);
				ws.subscribe(WS_CHANNELS.permissionRequest);
				ws.subscribe(WS_CHANNELS.permissionResolved);
				const welcome: ServerWelcome = {
					protocolVersion: PROTOCOL_VERSION,
					projects: listProjects(),
					recentProjects: listRecentProjects(),
					config: getConfig(),
					gooseStatus: currentGooseStatus(),
					pendingPermissions: pendingPermissionSnapshot(),
					...(appVersion ? { appVersion } : {}),
				};
				if (ws.send(JSON.stringify({ channel: WS_CHANNELS.serverWelcome, data: welcome })) === 0) {
					ws.close();
					return;
				}
				const providerLogin = providerLoginSnapshot(ws.data.clientKey);
				if (
					providerLogin &&
					ws.send(JSON.stringify({ channel: WS_CHANNELS.providerLogin, data: providerLogin })) === 0
				) {
					ws.close();
				}
			},
			async message(ws, message) {
				if (!isSocketSessionActive(ws)) {
					ws.close(1008, "authentication expired");
					return;
				}
				if (!isWebSocketPayloadWithinLimit(message)) {
					ws.close(1009, "message too large");
					return;
				}
				const raw = typeof message === "string" ? message : message.toString();
				let req: unknown;
				try {
					req = JSON.parse(raw);
				} catch {
					return;
				}
				if (typeof req !== "object" || req === null) return;
				if ("ack" in req && Array.isArray(req.ack)) {
					requestReplays.acknowledge(ws.data.clientKey, req.ack.filter(isRequestId));
					return;
				}
				if ("resume" in req && Array.isArray(req.resume)) {
					requestReplays.retain(ws.data.clientKey, req.resume.filter(isRequestId));
					return;
				}
				if (
					!("id" in req) ||
					typeof req.id !== "string" ||
					!("method" in req) ||
					typeof req.method !== "string"
				) {
					return;
				}
				const requestId = req.id;
				const method = req.method;
				const params = "params" in req ? req.params : undefined;
				const sessionId = "sessionId" in req ? req.sessionId : undefined;
				const fingerprint = createHash("sha256")
					.update(JSON.stringify([method, params, sessionId ?? null]))
					.digest("hex");
				try {
					const response = await requestReplays.run(
						ws.data.clientKey,
						requestId,
						fingerprint,
						async () => {
							try {
								const result = await handleRequest(method, params, {
									clientKey: ws.data.clientKey,
								});
								return JSON.stringify({ id: requestId, ok: true, result });
							} catch (err) {
								const error = err instanceof Error ? err.message : String(err);
								const code = errorCodeOf(err);
								return JSON.stringify({
									id: requestId,
									ok: false,
									error,
									...(code ? { errorCode: code } : {}),
								});
							}
						},
					);
					if (ws.send(response) === 0) ws.close();
				} catch (err) {
					const error = err instanceof Error ? err.message : String(err);
					if (ws.send(JSON.stringify({ id: requestId, ok: false, error })) === 0) ws.close();
				}
			},
			close(ws) {
				clearSocketExpiry(ws);
				if (stopping) return;
				const { clientKey } = ws.data;
				if (sockets.get(clientKey) === ws) {
					sockets.delete(clientKey);
				}
				if (sockets.has(clientKey) || reapTimers.has(clientKey)) return;
				armClientReap(clientKey);
			},
		},
	});

	setObjectiveMcpUrl(`http://127.0.0.1:${server.port ?? port}/mcp/objective`);

	setProjectPublisher((project) => {
		publishToSockets(WS_CHANNELS.projectUpdated, project);
	});

	const publishFsChanged = (payload: ProjectFsChangedPayload) => {
		publishToSockets(WS_CHANNELS.projectFsChanged, payload);
	};
	setWatchPublisher(publishFsChanged);

	setSettingsPublisher((config) => {
		publishToSockets(WS_CHANNELS.settingsChanged, config);
	});

	setSessionDeletedPublisher((payload: SessionDeletedPayload) => {
		publishToSockets(WS_CHANNELS.sessionDeleted, payload);
	});
	setSessionLifecyclePublisher((payload) => {
		publishToSockets(WS_CHANNELS.sessionLifecycleChanged, payload);
	});

	setSessionPublisher((payload) => publishToSockets(WS_CHANNELS.agentEvent, payload));
	setPermissionPublisher((payload) => publishToSockets(WS_CHANNELS.permissionRequest, payload));
	setPermissionResolvedPublisher((payload) =>
		publishToSockets(WS_CHANNELS.permissionResolved, payload),
	);
	setProviderLoginPublisher((clientKey, payload) =>
		publishToClient(clientKey, WS_CHANNELS.providerLogin, payload),
	);
	void refreshGooseStatus();

	return {
		get port() {
			return server.port ?? port;
		},
		stop() {
			stopAllWatches();
			disposeAllSessions();
			setObjectiveMcpUrl(undefined);
			stopping = true;
			for (const timer of reapTimers.values()) clearTimeout(timer);
			reapTimers.clear();
			for (const timer of socketExpiryTimers.values()) clearTimeout(timer);
			socketExpiryTimers.clear();
			sockets.clear();
			requestReplays.clear();
			setSettingsPublisher(null);
			setPermissionPublisher(() => {});
			setPermissionResolvedPublisher(() => {});
			setProviderLoginPublisher(() => {});
			setSessionLifecyclePublisher(() => {});
			server.stop(true);
		},
	};
}

async function serveProjectFile(pathname: string): Promise<Response> {
	if (pathname.length > 4096) return new Response("not found", { status: 404 });
	const rest = pathname.slice("/files/".length);
	const parts = rest.split("/");
	if (parts.length < 3) return new Response("not found", { status: 404 });
	let projectId: string;
	let rootIndex: number;
	let relPath: string;
	try {
		projectId = decodeURIComponent(parts[0] as string);
		rootIndex = Number(parts[1]);
		relPath = decodeURIComponent(parts.slice(2).join("/"));
	} catch {
		return new Response("not found", { status: 404 });
	}
	try {
		const root = getProject(projectId).roots[rootIndex];
		if (!root) return new Response("not found", { status: 404 });
		const file = Bun.file(resolveProjectFile(projectId, root, relPath));
		if (!(await file.exists())) return new Response("not found", { status: 404 });
		return new Response(file);
	} catch {
		return new Response("not found", { status: 404 });
	}
}

async function serveStatic(pathname: string, staticDir: string): Promise<Response> {
	const safe = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
	const requested = safe === "/" || safe === "" ? "index.html" : safe;
	const file = Bun.file(join(staticDir, requested));
	if (await file.exists()) return new Response(file);
	const index = Bun.file(join(staticDir, "index.html"));
	if (await index.exists()) return new Response(index);
	return new Response("not found", { status: 404 });
}
