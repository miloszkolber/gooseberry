import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const port = Number(process.env.PORT ?? "8787");
const artifactRoot = process.env.BROWSER_ARTIFACT_ROOT ?? "/artifacts";
const allowed = new Set(["open", "snapshot", "click", "fill", "screenshot", "console", "errors", "close"]);

function validSession(value) {
  return typeof value === "string" && /^[a-zA-Z0-9._-]{1,64}$/.test(value);
}

async function run(session, command, args = []) {
  if (!allowed.has(command)) throw new Error("unsupported browser command");
  if (!validSession(session)) throw new Error("invalid session");
  const safeArgs = args.map((value) => String(value));
  if (command === "open") {
    const url = safeArgs[0];
    if (!url || !/^https?:\/\//i.test(url)) throw new Error("open requires an http(s) URL");
  }
  if (safeArgs.some((value) => value.startsWith("--"))) {
    throw new Error("raw agent-browser flags are not accepted");
  }
  const sessionDir = join(artifactRoot, session);
  await mkdir(sessionDir, { recursive: true });
  const cliArgs = ["--session", session, command, ...safeArgs];
  return new Promise((resolve, reject) => {
    const child = spawn("agent-browser", cliArgs, {
      cwd: sessionDir,
      env: { PATH: process.env.PATH ?? "", HOME: "/home/browser" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const maxBytes = 512 * 1024;
    const collect = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill("SIGTERM");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), 120_000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
}

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/browser") {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 64 * 1024) throw new Error("request too large");
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await run(body.session, body.command, Array.isArray(body.args) ? body.args : []);
    res.writeHead(result.code === 0 ? 200 : 422, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
}).listen(port, "0.0.0.0");
