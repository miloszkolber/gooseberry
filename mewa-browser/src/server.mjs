import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, link, lstat, mkdir, open, readdir, rm, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { BrowserPolicyError, screenshotFilename, validateBrowserRequest } from "./policy.mjs";
import { assertStrongToken } from "./token.mjs";

const FIXED_ORIGIN = "http://mewa-browser.invalid";
const TEMP_ARTIFACT_PATTERN = /^\.mewa-screenshot-[A-Za-z0-9_-]+\.tmp$/;
const CLEANUP_CODES = new Set([
	"command_timeout",
	"output_limit",
	"child_process",
	"request_cancelled",
]);
const CLOSE_COMMANDS = new Set(["close"]);

const port = positiveInteger(process.env.PORT, 8787);
const artifactRoot = resolve(process.env.BROWSER_ARTIFACT_ROOT ?? "/artifacts");
const stateRoot = resolve(process.env.BROWSER_STATE_ROOT ?? "/tmp/mewa-browser");
const agentBrowser = process.env.AGENT_BROWSER_BINARY ?? "/app/node_modules/.bin/agent-browser";
const browserConfig = process.env.AGENT_BROWSER_CONFIG ?? "/app/config.json";
const authToken = process.env.MEWA_BROWSER_TOKEN ?? "";
const commandTimeoutMs = positiveInteger(process.env.BROWSER_COMMAND_TIMEOUT_MS, 120_000);
const requestTimeoutMs = positiveInteger(process.env.BROWSER_REQUEST_TIMEOUT_MS, 120_000);
const headersTimeoutMs = positiveInteger(process.env.BROWSER_HEADERS_TIMEOUT_MS, 15_000);
const keepAliveTimeoutMs = positiveInteger(process.env.BROWSER_KEEPALIVE_TIMEOUT_MS, 5_000);
const maxArtifactBytes = positiveInteger(process.env.BROWSER_MAX_ARTIFACT_BYTES, 64 * 1024 * 1024);
const maxTotalArtifactBytes = positiveInteger(
	process.env.BROWSER_MAX_TOTAL_ARTIFACT_BYTES ?? process.env.BROWSER_GLOBAL_ARTIFACT_BYTES,
	256 * 1024 * 1024,
);
const maxStateBytes = positiveInteger(process.env.BROWSER_MAX_STATE_BYTES, 256 * 1024 * 1024);
const maxSessions = positiveInteger(
	process.env.BROWSER_MAX_SESSIONS ?? process.env.BROWSER_MAX_SESSION_COUNT,
	16,
);
const maxProcessOutputBytes = 512 * 1024;
const maxRequestBytes = 64 * 1024;

let server;
let shuttingDown = false;
let shutdownPromise;
const activeChildren = new Set();
const activeRequests = new Set();
const artifactReservations = new Map();
let accountingTail = Promise.resolve();

class BrowserServiceError extends Error {
	constructor(code, message, hint, httpStatus = 400, cause) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "BrowserServiceError";
		this.code = code;
		this.hint = hint;
		this.httpStatus = httpStatus;
	}
}

function positiveInteger(value, fallback) {
	if (value === undefined || value === "") return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`Expected a positive integer, received: ${value}`);
	}
	return parsed;
}

function within(root, candidate) {
	const rel = relative(root, candidate);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function authorized(req) {
	if (!authToken) return false;
	const header = req.headers.authorization;
	const supplied =
		typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
	const expectedBuffer = Buffer.from(authToken);
	const suppliedBuffer = Buffer.from(supplied);
	return (
		expectedBuffer.length === suppliedBuffer.length &&
		expectedBuffer.length > 0 &&
		timingSafeEqual(expectedBuffer, suppliedBuffer)
	);
}

async function ensureDirectory(path, root = path) {
	if (!within(root, path))
		throw new BrowserServiceError("unsafe_path", "directory escaped its root");
	try {
		const info = await lstat(path);
		if (!info.isDirectory() || info.isSymbolicLink()) {
			throw new BrowserServiceError("unsafe_path", `not a real directory: ${path}`);
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
		await mkdir(path, { recursive: false, mode: 0o700 });
	}
}

async function measureTree(path, root = path, { ignoreTemporary = false } = {}) {
	let total = 0;
	let entries;
	try {
		entries = await readdir(path);
	} catch (error) {
		if (error?.code === "ENOENT") return 0;
		throw error;
	}
	for (const name of entries) {
		if (ignoreTemporary && TEMP_ARTIFACT_PATTERN.test(name)) continue;
		const child = join(path, name);
		if (!within(root, child))
			throw new BrowserServiceError("unsafe_path", "path escaped quota root");
		let info;
		try {
			info = await lstat(child);
		} catch (error) {
			// Chromium rotates temporary profile entries while commands are running.
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		// Never follow symlinks while accounting for browser state. Chromium creates
		// singleton links inside its private profile. Linked targets get no file or
		// artifact access through this service.
		if (info.isSymbolicLink()) continue;
		if (info.isDirectory()) total += await measureTree(child, root, { ignoreTemporary });
		else if (info.isFile()) total += info.size;
	}
	return total;
}

async function listDirectoryNames(root) {
	let entries;
	try {
		entries = await readdir(root);
	} catch (error) {
		if (error?.code === "ENOENT") return new Set();
		throw error;
	}
	const names = new Set();
	for (const name of entries) {
		const path = join(root, name);
		if (!within(root, path))
			throw new BrowserServiceError("unsafe_path", "path escaped session root");
		const info = await lstat(path);
		if (info.isDirectory() || info.isSymbolicLink()) names.add(name);
	}
	return names;
}

async function cleanupStaleTemps(root, removeLocks = false) {
	const sessions = await listDirectoryNames(root);
	for (const session of sessions) {
		const sessionDir = join(root, session);
		let info;
		try {
			info = await lstat(sessionDir);
		} catch (error) {
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		if (!info.isDirectory() || info.isSymbolicLink()) continue;
		let entries;
		try {
			entries = await readdir(sessionDir);
		} catch (error) {
			if (error?.code === "ENOENT") continue;
			throw error;
		}
		for (const name of entries) {
			if (!(removeLocks && name === ".lock") && !TEMP_ARTIFACT_PATTERN.test(name)) continue;
			const path = join(sessionDir, name);
			try {
				const childInfo = await lstat(path);
				if (childInfo.isFile() || childInfo.isSymbolicLink()) await unlink(path);
			} catch (error) {
				if (error?.code !== "ENOENT") throw error;
			}
		}
	}
}

async function initializeStorage() {
	await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
	await mkdir(stateRoot, { recursive: true, mode: 0o700 });
	await ensureDirectory(artifactRoot);
	await ensureDirectory(stateRoot);
	await cleanupStaleTemps(artifactRoot);
	await cleanupStaleTemps(stateRoot, true);
}

function runtimeEnvironment(stateDir) {
	const home = join(stateDir, "home");
	const tmp = join(stateDir, "tmp");
	const run = join(stateDir, "run");
	return {
		PATH: dirname(agentBrowser),
		HOME: home,
		TMPDIR: tmp,
		XDG_CONFIG_HOME: join(home, ".config"),
		XDG_DATA_HOME: join(home, ".local", "share"),
		XDG_STATE_HOME: join(home, ".local", "state"),
		AGENT_BROWSER_SOCKET_DIR: run,
		AGENT_BROWSER_CONTENT_BOUNDARIES: "1",
		AGENT_BROWSER_MAX_OUTPUT: "20000",
	};
}

async function withAccountingLock(task) {
	const previous = accountingTail;
	let release;
	accountingTail = new Promise((resolveRelease) => {
		release = resolveRelease;
	});
	await previous;
	try {
		return await task();
	} finally {
		release();
	}
}

function reservedArtifactBytes() {
	let total = 0;
	for (const bytes of artifactReservations.values()) total += bytes;
	return total;
}

function quotaError(
	message,
	hint = "remove browser artifacts or close the session before retrying",
) {
	return new BrowserServiceError("quota_exceeded", message, hint, 413);
}

async function reserveArtifactCapacity(bytes) {
	const token = await withAccountingLock(async () => {
		const used = await measureTree(artifactRoot, artifactRoot, { ignoreTemporary: true });
		if (used + reservedArtifactBytes() + bytes > maxTotalArtifactBytes) {
			throw quotaError("browser artifact storage quota is exceeded");
		}
		const reservation = randomUUID();
		artifactReservations.set(reservation, bytes);
		return reservation;
	});
	let released = false;
	return {
		setBytes: async (nextBytes) => {
			if (released) return;
			await withAccountingLock(async () => {
				if (artifactReservations.has(token)) artifactReservations.set(token, nextBytes);
			});
		},
		release: async () => {
			if (released) return;
			released = true;
			await withAccountingLock(async () => {
				artifactReservations.delete(token);
			});
		},
	};
}

async function checkGlobalArtifactQuota({ includeTemporary = false } = {}) {
	await withAccountingLock(async () => {
		const used = await measureTree(artifactRoot, artifactRoot, {
			ignoreTemporary: !includeTemporary,
		});
		if (used > maxTotalArtifactBytes) {
			throw quotaError("browser artifact storage quota is exceeded");
		}
	});
}

async function prepareSession(session) {
	return withAccountingLock(async () => {
		const sessions = await listDirectoryNames(stateRoot);
		if (!sessions.has(session) && sessions.size >= maxSessions) {
			throw new BrowserServiceError(
				"session_limit",
				"browser session limit has been reached",
				"close an existing browser session before starting another",
				429,
			);
		}

		const artifactDir = join(artifactRoot, session);
		const stateDir = join(stateRoot, session);
		await ensureDirectory(artifactDir, artifactRoot);
		await ensureDirectory(stateDir, stateRoot);
		for (const path of [join(stateDir, "home"), join(stateDir, "tmp"), join(stateDir, "run")]) {
			await ensureDirectory(path, stateDir);
		}
		return { artifactDir, stateDir };
	});
}

async function acquireLock(stateDir) {
	const lockPath = join(stateDir, ".lock");
	try {
		const handle = await open(lockPath, "wx", 0o600);
		let lockInfo;
		try {
			lockInfo = await handle.stat();
		} catch (error) {
			await handle.close().catch(() => undefined);
			await unlink(lockPath).catch(() => undefined);
			throw error;
		}
		return async () => {
			await handle.close().catch(() => undefined);
			try {
				const current = await lstat(lockPath);
				if (current.dev === lockInfo.dev && current.ino === lockInfo.ino) await unlink(lockPath);
			} catch {
				// The session may have been removed as part of cleanup.
			}
		};
	} catch (error) {
		if (error?.code === "EEXIST") {
			throw new BrowserServiceError(
				"session_busy",
				"browser session is busy",
				"retry after the active command finishes or use another session name",
				409,
			);
		}
		throw error;
	}
}

function trackChild(child) {
	activeChildren.add(child);
	const forget = () => activeChildren.delete(child);
	child.once("close", forget);
	child.once("error", forget);
	return child;
}

function spawnTracked(command, args, options) {
	return trackChild(spawn(command, args, options));
}

async function terminate(child) {
	if (!child || child.exitCode !== null) return;
	try {
		child.kill("SIGTERM");
	} catch {
		return;
	}
	await new Promise((resolveTimer) => {
		const timer = setTimeout(resolveTimer, 2_000);
		child.once("close", () => {
			clearTimeout(timer);
			resolveTimer();
		});
	});
	if (child.exitCode === null) {
		try {
			child.kill("SIGKILL");
		} catch {
			// The child may have exited between the check and kill.
		}
	}
}

function waitForChild(child) {
	return new Promise((resolveExit, reject) => {
		let settled = false;
		child.once("error", (error) => {
			if (settled) return;
			settled = true;
			reject(error);
		});
		child.once("close", (code, signal) => {
			if (settled) return;
			settled = true;
			resolveExit({ code, signal });
		});
	});
}

function childProcessError(error) {
	return new BrowserServiceError(
		"child_process",
		"the browser process could not be started or reaped",
		"verify the browser executable and retry",
		502,
		error,
	);
}

async function closeSession(session, stateDir, artifactDir) {
	let closeSucceeded = false;
	let child;
	try {
		child = spawnTracked(agentBrowser, ["--config", browserConfig, "--session", session, "close"], {
			env: runtimeEnvironment(stateDir),
			stdio: "ignore",
		});
		const timer = setTimeout(() => void terminate(child), 10_000);
		try {
			const result = await waitForChild(child);
			closeSucceeded = result.code === 0 && result.signal === null;
		} catch {
			closeSucceeded = false;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		closeSucceeded = false;
	}

	// A session that timed out or lost its child is no longer trusted. Always
	// remove its browser state. Preserve artifacts when the best-effort close
	// itself failed so an operator can still inspect the last output.
	await withAccountingLock(async () => {
		await rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
		if (closeSucceeded)
			await rm(artifactDir, { recursive: true, force: true }).catch(() => undefined);
	});
	return closeSucceeded;
}

function throwIfAborted(signal) {
	if (signal?.aborted) {
		throw new BrowserServiceError(
			"request_cancelled",
			"the browser request was cancelled",
			"retry the browser action",
			499,
		);
	}
}

function shouldDiscardSession(error) {
	return CLEANUP_CODES.has(error?.code);
}

async function runBrowser(request, signal) {
	const { artifactDir, stateDir } = await prepareSession(request.session);
	const releaseLock = await acquireLock(stateDir);
	let temporaryArtifact;
	let finalArtifact;
	let reservation = { setBytes: async () => undefined, release: async () => undefined };
	let timedOut = false;
	let outputExceeded = false;
	let artifactExceeded = false;
	let artifactMonitor;
	let cancelled = false;
	let child;

	try {
		throwIfAborted(signal);
		const closing = CLOSE_COMMANDS.has(request.command);
		const artifactBytes = await measureTree(artifactDir, artifactDir);
		const stateBytes = await measureTree(stateDir, stateDir);
		if (!closing && (artifactBytes > maxArtifactBytes || stateBytes > maxStateBytes)) {
			throw quotaError("browser session storage quota is exceeded");
		}
		if (!closing) await checkGlobalArtifactQuota();

		const args = [...request.args];
		const outputName = screenshotFilename(request);
		if (outputName) {
			finalArtifact = join(artifactDir, outputName);
			if (!within(artifactDir, finalArtifact) || basename(finalArtifact) !== outputName) {
				throw new BrowserServiceError("unsafe_path", "invalid screenshot filename");
			}
			try {
				await lstat(finalArtifact);
				throw new BrowserServiceError(
					"artifact_exists",
					"screenshot output must be a new path",
					"choose a new screenshot filename",
					409,
				);
			} catch (error) {
				if (error?.code !== "ENOENT") throw error;
			}
			if (maxArtifactBytes - artifactBytes <= 0) {
				throw quotaError("browser session artifact quota is exceeded");
			}
			reservation = await reserveArtifactCapacity(
				Math.min(maxArtifactBytes - artifactBytes, maxTotalArtifactBytes),
			);
			temporaryArtifact = join(artifactDir, `.mewa-screenshot-${randomUUID()}.tmp`);
			const positional = request.positionals[0];
			args[positional.index] = temporaryArtifact;
		}

		const stdout = [];
		const stderr = [];
		let outputBytes = 0;
		try {
			child = spawnTracked(
				agentBrowser,
				["--config", browserConfig, "--session", request.session, request.command, ...args],
				{
					cwd: artifactDir,
					env: runtimeEnvironment(stateDir),
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
		} catch (error) {
			throw childProcessError(error);
		}

		const collect = (target, chunk) => {
			if (outputExceeded) return;
			const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			outputBytes += data.length;
			if (outputBytes > maxProcessOutputBytes) {
				outputExceeded = true;
				void terminate(child);
				return;
			}
			target.push(data);
		};
		child.stdout.on("data", (chunk) => collect(stdout, chunk));
		child.stderr.on("data", (chunk) => collect(stderr, chunk));

		const abortHandler = () => {
			cancelled = true;
			void terminate(child);
		};
		signal?.addEventListener("abort", abortHandler, { once: true });
		const timer = setTimeout(() => {
			timedOut = true;
			void terminate(child);
		}, commandTimeoutMs);
		if (temporaryArtifact) {
			const availableArtifactBytes = maxArtifactBytes - artifactBytes;
			artifactMonitor = setInterval(() => {
				void lstat(temporaryArtifact)
					.then((info) => {
						if (info.size <= availableArtifactBytes || artifactExceeded) return;
						artifactExceeded = true;
						void terminate(child);
					})
					.catch((error) => {
						if (error?.code !== "ENOENT") {
							console.error("[mewa-browser] artifact quota check failed", error);
						}
					});
			}, 25);
		}

		let result;
		try {
			result = await waitForChild(child);
		} catch (error) {
			throw childProcessError(error);
		} finally {
			clearTimeout(timer);
			if (artifactMonitor) clearInterval(artifactMonitor);
			signal?.removeEventListener("abort", abortHandler);
		}

		if (cancelled) {
			throw new BrowserServiceError(
				"request_cancelled",
				"the browser request was cancelled",
				"retry the browser action",
				499,
			);
		}
		if (timedOut) {
			throw new BrowserServiceError(
				"command_timeout",
				`browser command exceeded ${commandTimeoutMs}ms`,
				"split the operation or retry with a simpler page action",
				504,
			);
		}
		if (outputExceeded) {
			throw new BrowserServiceError(
				"output_limit",
				"browser command output exceeded its limit",
				"request a smaller snapshot or more focused selector",
				413,
			);
		}
		if (artifactExceeded) {
			throw quotaError(
				"browser screenshot exceeded its artifact quota",
				"capture a smaller page or viewport",
			);
		}
		if (result.signal !== null)
			throw childProcessError(new Error(`browser exited on ${result.signal}`));
		if (result.code !== 0) {
			throw new BrowserServiceError(
				"browser_failed",
				`agent-browser exited with status ${String(result.code)}`,
				"retry the action; close the session if the failure persists",
				422,
			);
		}

		const finalStateBytes = await measureTree(stateDir, stateDir);
		const finalArtifactBytes = await measureTree(artifactDir, artifactDir);
		if (!closing && (finalArtifactBytes > maxArtifactBytes || finalStateBytes > maxStateBytes)) {
			throw quotaError(
				"browser output exceeded its storage quota",
				"remove browser artifacts and retry",
			);
		}

		let artifact;
		if (temporaryArtifact && finalArtifact) {
			const info = await lstat(temporaryArtifact);
			if (!info.isFile() || info.isSymbolicLink()) {
				throw new BrowserServiceError(
					"invalid_artifact",
					"screenshot output was not a regular file",
				);
			}
			await reservation.setBytes(info.size);
			await withAccountingLock(async () => {
				const total = await measureTree(artifactRoot, artifactRoot);
				if (total > maxTotalArtifactBytes) {
					throw quotaError(
						"browser output exceeded the global artifact quota",
						"remove browser artifacts and retry",
					);
				}
				try {
					await link(temporaryArtifact, finalArtifact);
				} catch (error) {
					if (error?.code === "EEXIST") {
						throw new BrowserServiceError(
							"artifact_exists",
							"screenshot output must be a new path",
							"choose a new screenshot filename",
							409,
						);
					}
					throw error;
				}
				await unlink(temporaryArtifact);
			});
			temporaryArtifact = undefined;
			artifact = {
				session: request.session,
				name: basename(finalArtifact),
				url: `/v1/artifacts/${encodeURIComponent(request.session)}/${encodeURIComponent(basename(finalArtifact))}`,
			};
		} else if (!closing) {
			await checkGlobalArtifactQuota();
		}

		if (closing) {
			await withAccountingLock(async () => {
				await rm(stateDir, { recursive: true, force: true });
				await rm(artifactDir, { recursive: true, force: true });
			});
		}

		return {
			outcome: "completed",
			command: request.command,
			code: result.code,
			stdout: Buffer.concat(stdout).toString("utf8"),
			stderr: Buffer.concat(stderr).toString("utf8"),
			artifact,
		};
	} catch (error) {
		if (temporaryArtifact) await unlink(temporaryArtifact).catch(() => undefined);
		if (child) await terminate(child).catch(() => undefined);
		if (shouldDiscardSession(error)) {
			if (shuttingDown) {
				await withAccountingLock(async () => {
					await rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
					await rm(artifactDir, { recursive: true, force: true }).catch(() => undefined);
				});
			} else {
				await closeSession(request.session, stateDir, artifactDir);
			}
		}
		throw error;
	} finally {
		await reservation.release().catch(() => undefined);
		await releaseLock();
	}
}

async function readJsonBody(req, signal) {
	const chunks = [];
	let size = 0;
	try {
		for await (const chunk of req) {
			throwIfAborted(signal);
			size += chunk.length;
			if (size > maxRequestBytes) {
				throw new BrowserServiceError(
					"request_too_large",
					"request body is too large",
					undefined,
					413,
				);
			}
			chunks.push(chunk);
		}
	} catch (error) {
		drainRequest(req);
		if (signal?.aborted)
			throw new BrowserServiceError(
				"request_cancelled",
				"the browser request was cancelled",
				undefined,
				499,
			);
		throw error;
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new BrowserServiceError("invalid_json", "request body must contain one JSON object");
	}
}

function json(res, status, body, extraHeaders = {}) {
	if (res.destroyed || res.writableEnded) return;
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		...extraHeaders,
	});
	res.end(JSON.stringify(body));
}

function methodNotAllowed(req, res, allow) {
	drainRequest(req);
	json(res, 405, { outcome: "rejected", code: "method_not_allowed" }, { allow });
}

function drainRequest(req) {
	req.resume();
}

function requireJsonContentType(req) {
	const contentType = req.headers["content-type"];
	if (
		typeof contentType !== "string" ||
		contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json"
	) {
		throw new BrowserServiceError(
			"unsupported_media_type",
			"POST requests must use application/json",
			"set Content-Type: application/json",
			415,
		);
	}
}

function decodePathPart(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		throw new BrowserServiceError("invalid_artifact_path", "artifact path encoding is invalid");
	}
}

async function serveArtifact(req, res, url, signal) {
	const match = /^\/v1\/artifacts\/([^/]+)\/([^/]+)$/.exec(url.pathname);
	if (!match) return false;
	if (!authorized(req)) {
		json(res, 401, { outcome: "rejected", code: "unauthorized" });
		return true;
	}

	const session = decodePathPart(match[1]);
	const name = decodePathPart(match[2]);
	if (
		!/^[A-Za-z0-9_-]{1,38}$/.test(session) ||
		basename(name) !== name ||
		!/^[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.(png|jpe?g|webp)$/i.test(name)
	) {
		json(res, 400, { outcome: "rejected", code: "invalid_artifact_path" });
		return true;
	}

	const sessionDir = join(artifactRoot, session);
	const path = join(sessionDir, name);
	if (!within(artifactRoot, path)) {
		json(res, 400, { outcome: "rejected", code: "invalid_artifact_path" });
		return true;
	}

	try {
		const rootInfo = await lstat(artifactRoot);
		const sessionInfo = await lstat(sessionDir);
		const info = await lstat(path);
		if (
			!rootInfo.isDirectory() ||
			rootInfo.isSymbolicLink() ||
			!sessionInfo.isDirectory() ||
			sessionInfo.isSymbolicLink() ||
			!info.isFile() ||
			info.isSymbolicLink() ||
			info.size > maxArtifactBytes
		) {
			throw new Error("invalid artifact");
		}
		const extension = name.toLowerCase().split(".").pop();
		const contentType =
			extension === "png"
				? "image/png"
				: extension === "jpg" || extension === "jpeg"
					? "image/jpeg"
					: extension === "webp"
						? "image/webp"
						: "application/octet-stream";
		const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		const openedInfo = await handle.stat();
		if (!openedInfo.isFile() || openedInfo.dev !== info.dev || openedInfo.ino !== info.ino) {
			await handle.close();
			throw new Error("artifact changed while opening");
		}
		res.writeHead(200, {
			"content-type": contentType,
			"content-length": String(openedInfo.size),
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		});
		try {
			await pipeline(createReadStream(path, { fd: handle.fd, autoClose: false }), res, { signal });
		} finally {
			await handle.close().catch(() => undefined);
		}
	} catch (error) {
		if (res.headersSent || res.destroyed) {
			if (!res.destroyed) res.destroy(error);
		} else {
			json(res, 404, { outcome: "failed", code: "artifact_not_found" });
		}
	}
	return true;
}

function parseRequestUrl(req) {
	try {
		const url = new URL(req.url ?? "/", FIXED_ORIGIN);
		if (url.origin !== FIXED_ORIGIN) {
			throw new Error("absolute request target is not permitted");
		}
		return url;
	} catch (error) {
		throw new BrowserServiceError(
			"invalid_url",
			"request URL is malformed",
			"send an origin-form request path",
			400,
			error,
		);
	}
}

function handleKnownRouteMethod(req, res, pathname) {
	if (pathname === "/health") {
		if (req.method !== "GET") {
			methodNotAllowed(req, res, "GET");
			return true;
		}
		json(res, 200, { status: "ok" });
		return true;
	}
	if (pathname === "/v1/browser") {
		if (req.method !== "POST") {
			methodNotAllowed(req, res, "POST");
			return true;
		}
		return false;
	}
	if (/^\/v1\/artifacts\/[^/]+\/[^/]+$/.test(pathname)) {
		if (req.method !== "GET") {
			methodNotAllowed(req, res, "GET");
			return true;
		}
		return false;
	}
	return undefined;
}

async function handleRequest(req, res) {
	const controller = new AbortController();
	activeRequests.add(controller);
	const abortRequest = () => {
		if (!res.writableFinished) controller.abort();
	};
	req.once("aborted", abortRequest);
	res.once("close", abortRequest);
	try {
		if (shuttingDown) {
			json(res, 503, { outcome: "rejected", code: "shutting_down" }, { connection: "close" });
			return;
		}
		const url = parseRequestUrl(req);
		const routeResult = handleKnownRouteMethod(req, res, url.pathname);
		if (routeResult === true) return;
		if (routeResult === undefined) {
			json(res, 404, { outcome: "rejected", code: "not_found" });
			return;
		}

		if (url.pathname.startsWith("/v1/artifacts/")) {
			await serveArtifact(req, res, url, controller.signal);
			return;
		}
		if (!authorized(req)) {
			drainRequest(req);
			json(res, 401, { outcome: "rejected", code: "unauthorized" });
			return;
		}
		try {
			requireJsonContentType(req);
		} catch (error) {
			drainRequest(req);
			throw error;
		}
		const request = validateBrowserRequest(await readJsonBody(req, controller.signal));
		json(res, 200, await runBrowser(request, controller.signal));
	} finally {
		activeRequests.delete(controller);
		req.removeListener("aborted", abortRequest);
		res.removeListener("close", abortRequest);
	}
}

function containRequestError(error, res) {
	if (res.destroyed || res.writableEnded) return;
	if (res.headersSent) {
		res.destroy(error);
		return;
	}
	if (error instanceof BrowserPolicyError || error instanceof BrowserServiceError) {
		json(res, error.httpStatus ?? 400, {
			outcome: "rejected",
			code: error.code,
			warnings: [error.message],
			hints: error.hint ? [error.hint] : [],
		});
		return;
	}
	console.error(error);
	json(res, 500, { outcome: "failed", code: "internal_error" });
}

function requestHandler(req, res) {
	void handleRequest(req, res).catch((error) => containRequestError(error, res));
}

export async function startServer() {
	assertStrongToken(authToken);
	await access(agentBrowser, constants.X_OK);
	await access(browserConfig, constants.R_OK);
	await initializeStorage();
	server = createServer(requestHandler);
	server.requestTimeout = requestTimeoutMs;
	server.timeout = requestTimeoutMs;
	server.headersTimeout = headersTimeoutMs;
	server.keepAliveTimeout = keepAliveTimeoutMs;
	server.on("clientError", (_error, socket) => {
		if (!socket.destroyed) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
	});
	await new Promise((resolveListen, rejectListen) => {
		const onError = (error) => {
			server.removeListener("listening", onListening);
			rejectListen(error);
		};
		const onListening = () => {
			server.removeListener("error", onError);
			resolveListen();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "0.0.0.0");
	});
	console.log(`[mewa-browser] listening on ${port}`);
	return server;
}

export async function stopServer() {
	if (shutdownPromise) return shutdownPromise;
	shuttingDown = true;
	shutdownPromise = (async () => {
		for (const controller of activeRequests) controller.abort();
		const childrenPromise = Promise.all(
			[...activeChildren].map((child) => terminate(child).catch(() => undefined)),
		);
		let closePromise = Promise.resolve();
		if (server) {
			closePromise = new Promise((resolveClose) => {
				server.close(() => resolveClose());
				server.closeIdleConnections?.();
			}).catch(() => undefined);
		}
		await Promise.all([closePromise, childrenPromise]);
	})();
	return shutdownPromise;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.once("SIGTERM", () => void stopServer());
	process.once("SIGINT", () => void stopServer());
	await startServer();
}
