import { timingSafeEqual, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  unlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import {
  BrowserPolicyError,
  screenshotFilename,
  validateBrowserRequest,
} from "./policy.mjs";

const port = positiveInteger(process.env.PORT, 8787);
const artifactRoot = resolve(process.env.BROWSER_ARTIFACT_ROOT ?? "/artifacts");
const stateRoot = resolve(process.env.BROWSER_STATE_ROOT ?? "/tmp/mewa-browser");
const agentBrowser = process.env.AGENT_BROWSER_BINARY ?? "/app/node_modules/.bin/agent-browser";
const browserConfig = process.env.AGENT_BROWSER_CONFIG ?? "/app/config.json";
const authToken = process.env.MEWA_BROWSER_TOKEN ?? "";
const commandTimeoutMs = positiveInteger(process.env.BROWSER_COMMAND_TIMEOUT_MS, 120_000);
const maxArtifactBytes = positiveInteger(process.env.BROWSER_MAX_ARTIFACT_BYTES, 64 * 1024 * 1024);
const maxStateBytes = positiveInteger(process.env.BROWSER_MAX_STATE_BYTES, 256 * 1024 * 1024);
const maxProcessOutputBytes = 512 * 1024;
const maxRequestBytes = 64 * 1024;

class BrowserServiceError extends Error {
  constructor(code, message, hint, httpStatus = 400) {
    super(message);
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
  const header = req.headers.authorization ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expectedBuffer = Buffer.from(authToken);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    expectedBuffer.length > 0 &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function ensureDirectory(path, root = path) {
  if (!within(root, path)) throw new BrowserServiceError("unsafe_path", "directory escaped its root");
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

async function measureTree(path, root = path) {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path);
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  for (const name of entries) {
    const child = join(path, name);
    if (!within(root, child)) throw new BrowserServiceError("unsafe_path", "path escaped quota root");
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
    if (info.isDirectory()) total += await measureTree(child, root);
    else if (info.isFile()) total += info.size;
  }
  return total;
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

async function prepareSession(session) {
  await ensureDirectory(artifactRoot);
  await ensureDirectory(stateRoot);
  const artifactDir = join(artifactRoot, session);
  const stateDir = join(stateRoot, session);
  await ensureDirectory(artifactDir, artifactRoot);
  await ensureDirectory(stateDir, stateRoot);
  for (const path of [join(stateDir, "home"), join(stateDir, "tmp"), join(stateDir, "run")]) {
    await ensureDirectory(path, stateDir);
  }
  return { artifactDir, stateDir };
}

async function acquireLock(stateDir) {
  const lockPath = join(stateDir, ".lock");
  try {
    const handle = await open(lockPath, "wx", 0o600);
    return async () => {
      await handle.close().catch(() => undefined);
      await unlink(lockPath).catch(() => undefined);
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

async function terminate(child) {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 2_000));
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function closeSession(session, stateDir) {
  await new Promise((resolveClose) => {
    const child = spawn(
      agentBrowser,
      ["--config", browserConfig, "--session", session, "close"],
      {
        env: runtimeEnvironment(stateDir),
        stdio: "ignore",
      },
    );
    const timer = setTimeout(() => void terminate(child), 10_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolveClose();
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolveClose();
    });
  });
  await rm(stateDir, { recursive: true, force: true }).catch(() => undefined);
}

async function runBrowser(request) {
  const { artifactDir, stateDir } = await prepareSession(request.session);
  const releaseLock = await acquireLock(stateDir);
  let temporaryArtifact;
  let finalArtifact;
  let timedOut = false;
  let outputExceeded = false;
  let child;

  try {
    const artifactBytes = await measureTree(artifactDir, artifactDir);
    const stateBytes = await measureTree(stateDir, stateDir);
    if (artifactBytes > maxArtifactBytes || stateBytes > maxStateBytes) {
      throw new BrowserServiceError(
        "quota_exceeded",
        "browser session storage quota is exceeded",
        "remove browser artifacts or close the session before retrying",
        413,
      );
    }

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
      temporaryArtifact = join(artifactDir, `.mewa-screenshot-${randomUUID()}.tmp`);
      const positional = request.positionals[0];
      args[positional.index] = temporaryArtifact;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    child = spawn(
      agentBrowser,
      ["--config", browserConfig, "--session", request.session, request.command, ...args],
      {
        cwd: artifactDir,
        env: runtimeEnvironment(stateDir),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const collect = (target, chunk) => {
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

    const timer = setTimeout(() => {
      timedOut = true;
      void terminate(child);
    }, commandTimeoutMs);

    const exitCode = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("close", resolveExit);
    }).finally(() => clearTimeout(timer));

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
    if (exitCode !== 0) {
      throw new BrowserServiceError(
        "browser_failed",
        `agent-browser exited with status ${String(exitCode)}`,
        "retry the action; close the session if the failure persists",
        422,
      );
    }

    const finalArtifactBytes = await measureTree(artifactDir, artifactDir);
    const finalStateBytes = await measureTree(stateDir, stateDir);
    if (finalArtifactBytes > maxArtifactBytes || finalStateBytes > maxStateBytes) {
      throw new BrowserServiceError(
        "quota_exceeded",
        "browser output exceeded its storage quota",
        "remove browser artifacts and retry",
        413,
      );
    }

    let artifact;
    if (temporaryArtifact && finalArtifact) {
      const info = await lstat(temporaryArtifact);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new BrowserServiceError("invalid_artifact", "screenshot output was not a regular file");
      }
      await link(temporaryArtifact, finalArtifact);
      await unlink(temporaryArtifact);
      temporaryArtifact = undefined;
      artifact = {
        session: request.session,
        name: basename(finalArtifact),
        url: `/v1/artifacts/${encodeURIComponent(request.session)}/${encodeURIComponent(basename(finalArtifact))}`,
      };
    }

    if (["close", "quit", "exit"].includes(request.command)) {
      await rm(stateDir, { recursive: true, force: true });
    }

    return {
      outcome: "completed",
      command: request.command,
      code: exitCode,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      artifact,
    };
  } catch (error) {
    if (temporaryArtifact) await unlink(temporaryArtifact).catch(() => undefined);
    if (child) await terminate(child).catch(() => undefined);
    await closeSession(request.session, stateDir);
    throw error;
  } finally {
    await releaseLock();
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      throw new BrowserServiceError("request_too_large", "request body is too large", undefined, 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new BrowserServiceError("invalid_json", "request body must contain one JSON object");
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function serveArtifact(req, res, url) {
  const match = /^\/v1\/artifacts\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (!match) return false;
  if (!authorized(req)) {
    json(res, 401, { outcome: "rejected", code: "unauthorized" });
    return true;
  }
  const session = decodeURIComponent(match[1]);
  const name = decodeURIComponent(match[2]);
  if (!/^[A-Za-z0-9_-]{1,38}$/.test(session) || basename(name) !== name) {
    json(res, 400, { outcome: "rejected", code: "invalid_artifact_path" });
    return true;
  }
  const path = join(artifactRoot, session, name);
  if (!within(artifactRoot, path)) {
    json(res, 400, { outcome: "rejected", code: "invalid_artifact_path" });
    return true;
  }
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxArtifactBytes) {
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
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": String(info.size),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    createReadStream(path).pipe(res);
  } catch {
    json(res, 404, { outcome: "failed", code: "artifact_not_found" });
  }
  return true;
}

await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
await mkdir(stateRoot, { recursive: true, mode: 0o700 });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { status: "ok" });
    return;
  }
  if (req.method === "GET" && (await serveArtifact(req, res, url))) return;
  if (req.method !== "POST" || url.pathname !== "/v1/browser") {
    json(res, 404, { outcome: "rejected", code: "not_found" });
    return;
  }
  if (!authorized(req)) {
    json(res, 401, { outcome: "rejected", code: "unauthorized" });
    return;
  }

  try {
    const request = validateBrowserRequest(await readJsonBody(req));
    json(res, 200, await runBrowser(request));
  } catch (error) {
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
}).listen(port, "0.0.0.0", () => {
  console.log(`[mewa-browser] listening on ${port}`);
});
