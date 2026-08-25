import { createHash, randomUUID } from "node:crypto";
import { join, normalize } from "node:path";
import type {
	ServerWelcome,
	SessionDeletedPayload,
	TerminalTabsPush,
	WorkspaceFsChangedPayload,
} from "@mewa-code/contracts";
import { isCodeToken, PROTOCOL_VERSION, WS_CHANNELS } from "@mewa-code/contracts";
import { errorCodeOf } from "@mewa-code/shared/codedError";
import {
	disposeAllSessions,
	getSessionWorkspaceId,
	setExtUiPublisher,
	setSessionDeletedPublisher,
	setSessionPublisher,
	setSkillAdmissionResolver,
} from "../agent";
import { cancelAllLogins, setLoginPublisher } from "../auth";
import { resolveWorktreeFile } from "../fs";
import {
	getProjects,
	listProjects,
	listRecentProjects,
	openProject,
	setProjectPublisher,
} from "../projects";
import { getConfig, setSettingsPublisher } from "../settings";
import {
	closeAllTerminals,
	persistTerminalSessions,
	resumeClientTerminals,
	reviveTerminalSessions,
	setTerminalPublisher,
	setTerminalTabsPublisher,
} from "../terminal";
import {
	setRepoMetaPublisher,
	setSkillPathClassifier,
	setWatchPublisher,
	stopAllWatches,
} from "../watch";
import { getWorkspace, refreshUserOwnedWorkspace, setWorkspacePublisher } from "../workspaces";
import {
	isPromptCommitted,
	isSettledTurn,
	maybeAutoRenameWorkspace,
	maybeNaiveNameWorkspace,
} from "./autoRename";
import { setFsNudgePublisher } from "./fsNudge";
import { handleRequest } from "./handlers";
import { RequestReplayCache } from "./requestReplayCache";
import { terminalDeliveryForSendStatus } from "./terminalSend";
import {
	authorizeWebSocketUpgrade,
	isAuthorizedHttpRequest,
	readWebSocketAuthConfig,
	validateAuthTokens,
} from "./webSocketAuth";

export interface CreateServerOptions {
	port?: number;
	host?: string;
	staticDir?: string;
	projectPath?: string;
	appVersion?: string;
}

export interface RunningServer {
	readonly port: number;
	stop: () => void;
}

interface SocketData {
	clientKey: string;
}

const CLIENT_REPLAY_RETENTION_MS = 60_000;
const BROWSER_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
const BROWSER_ARTIFACT_TIMEOUT_MS = 30_000;
const BROWSER_ARTIFACT_PATH = /^\/v1\/artifacts\/([^/]+)\/([^/]+)$/;
const BROWSER_SESSION = /^[A-Za-z0-9_-]{1,38}$/;
const BROWSER_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.(?:png|jpe?g|webp)$/i;
const BROWSER_ARTIFACT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_WS_MESSAGE_BYTES = 1024 * 1024;
const CLIENT_KEY = /^[A-Za-z0-9_-]{1,128}$/;

const PROJECT_SKILL_PATH = /^\.pi\/skills(?:\/|$)/;

function isProjectSkillPath(relativePath: string): boolean {
	return PROJECT_SKILL_PATH.test(relativePath.replaceAll("\\", "/"));
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

function browserArtifactServiceUrl(): URL | undefined {
	const configured = (process.env.MEWA_BROWSER_URL ?? "http://mewa-browser:8787").trim();
	try {
		const url = new URL(configured);
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
			return undefined;
		return url;
	} catch {
		return undefined;
	}
}

async function proxyBrowserArtifact(pathname: string): Promise<Response> {
	const target = browserArtifactTarget(pathname);
	if (!target) return new Response("not found", { status: 404 });

	const token = process.env.MEWA_BROWSER_TOKEN;
	const serviceUrl = browserArtifactServiceUrl();
	if (!isCodeToken(token) || !serviceUrl)
		return new Response("browser artifact proxy unavailable", { status: 503 });

	let upstream: Response;
	try {
		upstream = await fetch(new URL(target.path, serviceUrl), {
			headers: { authorization: `Bearer ${token}` },
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
	const { port = 24242, host = "localhost", staticDir, projectPath, appVersion } = options;
	validateAuthTokens();
	const websocketAuth = readWebSocketAuthConfig();

	const sockets = new Map<string, Bun.ServerWebSocket<SocketData>>();
	const reapTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const requestReplays = new RequestReplayCache<string>();
	const terminalBackpressured = new Set<string>();
	let stopping = false;

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

	const server = Bun.serve<SocketData, never>({
		port,
		hostname: host,
		async fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/ws") {
				const authorization = authorizeWebSocketUpgrade(req, websocketAuth);
				if (authorization instanceof Response) return authorization;
				const requestedClientKey = url.searchParams.get("client");
				const clientKey =
					requestedClientKey && CLIENT_KEY.test(requestedClientKey)
						? requestedClientKey
						: `anon-${randomUUID()}`;
				return srv.upgrade(req, {
					data: { clientKey },
					headers: {
						"Sec-WebSocket-Protocol": authorization.protocol,
						"Set-Cookie": authorization.setCookie,
					},
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
				return serveWorktreeFile(url.pathname);
			}
			if (staticDir) {
				return serveStatic(url.pathname, staticDir);
			}
			return new Response("not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				const replaced = sockets.get(ws.data.clientKey);
				sockets.set(ws.data.clientKey, ws);
				if (replaced && replaced !== ws) replaced.close();
				terminalBackpressured.delete(ws.data.clientKey);
				const pendingReap = reapTimers.get(ws.data.clientKey);
				if (pendingReap !== undefined) {
					clearTimeout(pendingReap);
					reapTimers.delete(ws.data.clientKey);
				}
				ws.subscribe(WS_CHANNELS.piEvent);
				ws.subscribe(WS_CHANNELS.piExtensionUi);
				ws.subscribe(WS_CHANNELS.sessionDeleted);
				ws.subscribe(WS_CHANNELS.providerLogin);
				ws.subscribe(WS_CHANNELS.projectUpdated);
				ws.subscribe(WS_CHANNELS.terminalTabs);
				ws.subscribe(WS_CHANNELS.workspaceCreated);
				ws.subscribe(WS_CHANNELS.workspaceUpdated);
				ws.subscribe(WS_CHANNELS.workspaceRemoved);
				ws.subscribe(WS_CHANNELS.workspaceFsChanged);
				ws.subscribe(WS_CHANNELS.settingsChanged);
				const welcome: ServerWelcome = {
					protocolVersion: PROTOCOL_VERSION,
					projects: listProjects(),
					recentProjects: listRecentProjects(),
					config: getConfig(),
					...(appVersion ? { appVersion } : {}),
				};
				const welcomeStatus = ws.send(
					JSON.stringify({ channel: WS_CHANNELS.serverWelcome, data: welcome }),
				);
				const welcomeDelivery = terminalDeliveryForSendStatus(welcomeStatus);
				if (welcomeDelivery === "unavailable") {
					ws.close();
					return;
				}
				if (welcomeDelivery === "backpressured") {
					terminalBackpressured.add(ws.data.clientKey);
				}
				resumeClientTerminals(ws.data.clientKey);
			},
			async message(ws, message) {
				const raw = typeof message === "string" ? message : message.toString();
				if (raw.length > MAX_WS_MESSAGE_BYTES) {
					ws.close();
					return;
				}
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
			drain(ws) {
				if (sockets.get(ws.data.clientKey) !== ws) return;
				terminalBackpressured.delete(ws.data.clientKey);
				resumeClientTerminals(ws.data.clientKey);
			},
			close(ws) {
				if (stopping) return;
				const { clientKey } = ws.data;
				if (sockets.get(clientKey) === ws) {
					sockets.delete(clientKey);
					terminalBackpressured.delete(clientKey);
				}
				if (sockets.has(clientKey) || reapTimers.has(clientKey)) return;
				armClientReap(clientKey);
			},
		},
	});

	setTerminalPublisher((clientKey, channel, data) => {
		if (terminalBackpressured.has(clientKey)) return "unavailable";
		const ws = sockets.get(clientKey);
		if (!ws) return "unavailable";
		try {
			const delivery = terminalDeliveryForSendStatus(ws.send(JSON.stringify({ channel, data })));
			if (delivery !== "delivered") terminalBackpressured.add(clientKey);
			return delivery;
		} catch {
			terminalBackpressured.add(clientKey);
			ws.close();
			return "unavailable";
		}
	});

	setSkillAdmissionResolver((workspaceId) => {
		try {
			const { projectId, skillOverrides } = getWorkspace(workspaceId);
			const project = getProjects().find((p) => p.id === projectId);
			return {
				trusted: project?.trusted === true,
				disabled: project?.disabledSkills ?? [],
				disabledGroups: project?.disabledGroups ?? [],
				overrides: skillOverrides ?? {},
			};
		} catch {
			return { trusted: false, disabled: [], disabledGroups: [], overrides: {} };
		}
	});

	setProjectPublisher((project) => {
		server.publish(
			WS_CHANNELS.projectUpdated,
			JSON.stringify({ channel: WS_CHANNELS.projectUpdated, data: project }),
		);
	});

	setTerminalTabsPublisher((workspaceId, tabs) => {
		const data: TerminalTabsPush = { workspaceId, tabs };
		server.publish(
			WS_CHANNELS.terminalTabs,
			JSON.stringify({ channel: WS_CHANNELS.terminalTabs, data }),
		);
	});

	setWorkspacePublisher((event) => {
		const channel =
			event.kind === "created"
				? WS_CHANNELS.workspaceCreated
				: event.kind === "updated"
					? WS_CHANNELS.workspaceUpdated
					: WS_CHANNELS.workspaceRemoved;
		const data =
			event.kind === "removed" ? { projectId: event.projectId, id: event.id } : event.workspace;
		server.publish(channel, JSON.stringify({ channel, data }));
	});

	const publishFsChanged = (payload: WorkspaceFsChangedPayload) => {
		server.publish(
			WS_CHANNELS.workspaceFsChanged,
			JSON.stringify({ channel: WS_CHANNELS.workspaceFsChanged, data: payload }),
		);
	};
	setWatchPublisher(publishFsChanged);
	setSkillPathClassifier(isProjectSkillPath);
	setFsNudgePublisher(publishFsChanged);

	setRepoMetaPublisher((workspaceId) => {
		refreshUserOwnedWorkspace(workspaceId);
		publishFsChanged({ workspaceId, paths: [], truncated: false, skillChange: "none" });
	});

	setSettingsPublisher((config) => {
		server.publish(
			WS_CHANNELS.settingsChanged,
			JSON.stringify({ channel: WS_CHANNELS.settingsChanged, data: config }),
		);
	});

	setSessionDeletedPublisher((payload: SessionDeletedPayload) => {
		server.publish(
			WS_CHANNELS.sessionDeleted,
			JSON.stringify({ channel: WS_CHANNELS.sessionDeleted, data: payload }),
		);
	});

	setSessionPublisher((payload) => {
		server.publish(
			WS_CHANNELS.piEvent,
			JSON.stringify({ channel: WS_CHANNELS.piEvent, data: payload }),
		);
		if (isPromptCommitted(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) void maybeNaiveNameWorkspace(payload.sessionId, workspaceId);
		} else if (isSettledTurn(payload.event)) {
			const workspaceId = getSessionWorkspaceId(payload.sessionId);
			if (workspaceId) void maybeAutoRenameWorkspace(payload.sessionId, workspaceId);
		}
	});

	setExtUiPublisher((request) => {
		server.publish(
			WS_CHANNELS.piExtensionUi,
			JSON.stringify({ channel: WS_CHANNELS.piExtensionUi, data: request }),
		);
	});

	setLoginPublisher((push) => {
		server.publish(
			WS_CHANNELS.providerLogin,
			JSON.stringify({ channel: WS_CHANNELS.providerLogin, data: push }),
		);
	});

	reviveTerminalSessions();

	if (projectPath) {
		try {
			openProject(projectPath);
		} catch (err) {
			console.warn(
				`Could not open project ${projectPath}: ${err instanceof Error ? err.message : err}`,
			);
		}
	}

	return {
		get port() {
			return server.port ?? port;
		},
		stop() {
			cancelAllLogins();
			stopAllWatches();
			disposeAllSessions();
			stopping = true;
			for (const timer of reapTimers.values()) clearTimeout(timer);
			reapTimers.clear();
			sockets.clear();
			terminalBackpressured.clear();
			requestReplays.clear();
			persistTerminalSessions();
			closeAllTerminals();
			setSettingsPublisher(null);
			server.stop(true);
		},
	};
}

async function serveWorktreeFile(pathname: string): Promise<Response> {
	if (pathname.length > 4096) return new Response("not found", { status: 404 });
	const rest = pathname.slice("/files/".length);
	const slash = rest.indexOf("/");
	if (slash <= 0) return new Response("not found", { status: 404 });
	let workspaceId: string;
	let relPath: string;
	try {
		workspaceId = decodeURIComponent(rest.slice(0, slash));
		relPath = decodeURIComponent(rest.slice(slash + 1));
	} catch {
		return new Response("not found", { status: 404 });
	}
	try {
		const file = Bun.file(resolveWorktreeFile(workspaceId, relPath));
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
