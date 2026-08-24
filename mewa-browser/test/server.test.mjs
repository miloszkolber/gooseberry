import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer as createProbeServer } from "node:net";

const token = "server-test-token";
const serviceRoot = await mkdtemp(join(tmpdir(), "mewa-browser-test-"));
const artifactRoot = join(serviceRoot, "artifacts");
const stateRoot = join(serviceRoot, "state");
const fakeBrowser = join(serviceRoot, "fake-browser");
let port;
let child;

async function freePort() {
  const probe = createProbeServer();
  await new Promise((resolveProbe, rejectProbe) => {
    probe.once("error", rejectProbe);
    probe.listen(0, "127.0.0.1", resolveProbe);
  });
  const address = probe.address();
  const value = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return value;
}

function rawRequest({ method = "GET", path = "/", headers = {}, body = "" } = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: { ...headers, "content-length": Buffer.byteLength(body) },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("end", () => {
          resolveResponse({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    request.once("error", rejectResponse);
    request.end(body);
  });
}

async function browser(command, session, args = []) {
  const response = await rawRequest({
    method: "POST",
    path: "/v1/browser",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ command, session, args }),
  });
  return { ...response, json: JSON.parse(response.body) };
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await rawRequest({ path: "/health" });
      if (response.status === 200) return;
    } catch {
      // The child may still be binding its port.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error("browser test service did not become ready");
}

before(async () => {
  const fakeSource = `#!${process.execPath}
import { access, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const argv = process.argv.slice(2);
const sessionIndex = argv.indexOf("--session");
const command = argv[sessionIndex + 2];
const commandArgs = argv.slice(sessionIndex + 3);
const home = process.env.HOME;

if (command === "open" && commandArgs[0]?.includes("timeout")) {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (command === "reload") process.kill(process.pid, "SIGKILL");
if (command === "click") {
  await writeFile(join(home, "healthy"), "yes");
  process.stdout.write("failed action");
  process.exitCode = 7;
} else if (command === "snapshot" && commandArgs.includes("--compact")) {
  process.stdout.write("x".repeat(600000));
} else if (command === "snapshot") {
  try {
    await access(join(home, "healthy"));
    process.stdout.write("healthy");
  } catch {
    process.stdout.write("snapshot");
  }
} else if (command === "screenshot") {
  await writeFile(commandArgs.at(-1), "fake-image");
} else {
  process.stdout.write(command);
}
if (command === "close") await appendFile(join(home, "closed"), "yes").catch(() => undefined);
`;
  await writeFile(fakeBrowser, fakeSource, { mode: 0o700 });
  await chmod(fakeBrowser, 0o700);
  await mkdir(join(artifactRoot, "stale"), { recursive: true });
  await writeFile(join(artifactRoot, "stale", ".mewa-screenshot-stale.tmp"), "stale");
  await mkdir(join(stateRoot, "stale"), { recursive: true });
  await writeFile(join(stateRoot, "stale", ".lock"), "stale");
  await writeFile(join(serviceRoot, "config.json"), "{}");
  port = await freePort();
  child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      MEWA_BROWSER_TOKEN: token,
      AGENT_BROWSER_BINARY: fakeBrowser,
      AGENT_BROWSER_CONFIG: join(serviceRoot, "config.json"),
      BROWSER_ARTIFACT_ROOT: artifactRoot,
      BROWSER_STATE_ROOT: stateRoot,
      BROWSER_COMMAND_TIMEOUT_MS: "100",
      BROWSER_MAX_ARTIFACT_BYTES: "64",
      BROWSER_MAX_TOTAL_ARTIFACT_BYTES: "10",
      BROWSER_MAX_SESSIONS: "3",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForHealth();
  await assert.rejects(access(join(artifactRoot, "stale", ".mewa-screenshot-stale.tmp")));
  await assert.rejects(access(join(stateRoot, "stale", ".lock")));
  await rm(join(artifactRoot, "stale"), { recursive: true, force: true });
  await rm(join(stateRoot, "stale"), { recursive: true, force: true });
});

after(async () => {
  if (child && child.exitCode === null) child.kill("SIGTERM");
  if (child) {
    await new Promise((resolveExit) => {
      child.once("exit", resolveExit);
      setTimeout(resolveExit, 3_000);
    });
  }
  await rm(serviceRoot, { recursive: true, force: true });
});

test("contains malformed requests, enforces route methods, and requires JSON", async () => {
  const malformedHost = await rawRequest({ path: "/health", headers: { host: "[" } });
  assert.equal(malformedHost.status, 200);

  const malformedTarget = await rawRequest({ path: "%", headers: { host: "[" } });
  assert.equal(malformedTarget.status, 400);

  const wrongMethod = await rawRequest({ path: "/v1/browser" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, "POST");
  const healthMethod = await rawRequest({ method: "POST", path: "/health", body: "{}" });
  assert.equal(healthMethod.status, 405);
  assert.equal(healthMethod.headers.allow, "GET");
  const artifactMethod = await rawRequest({ method: "POST", path: "/v1/artifacts/demo/screen.png", body: "{}" });
  assert.equal(artifactMethod.status, 405);
  assert.equal(artifactMethod.headers.allow, "GET");

  const wrongContentType = await rawRequest({
    method: "POST",
    path: "/v1/browser",
    headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
    body: "{}",
  });
  assert.equal(wrongContentType.status, 415);
});

test("preserves healthy sessions for ordinary action errors and duplicate artifacts", async () => {
  const failed = await browser("click", "healthy", ["#button"]);
  assert.equal(failed.status, 422);
  const snapshot = await browser("snapshot", "healthy");
  assert.equal(snapshot.status, 200);
  assert.match(snapshot.json.stdout, /healthy/);

  const first = await browser("screenshot", "screens", ["screen.png"]);
  assert.equal(first.status, 200);
  const duplicate = await browser("screenshot", "screens", ["screen.png"]);
  assert.equal(duplicate.status, 409);
  const stillHealthy = await browser("snapshot", "screens");
  assert.equal(stillHealthy.status, 200);

  const artifact = await rawRequest({
    path: "/v1/artifacts/screens/screen.png",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(artifact.status, 200);
  assert.equal(artifact.body, "fake-image");

  await symlink(join(serviceRoot, "outside.png"), join(artifactRoot, "screens", "linked.png"));
  const linked = await rawRequest({
    path: "/v1/artifacts/screens/linked.png",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(linked.status, 404);
});

test("removes artifacts after a successful close and enforces global quotas", async () => {
  const closed = await browser("close", "screens");
  assert.equal(closed.status, 200);
  const artifact = await rawRequest({
    path: "/v1/artifacts/screens/screen.png",
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(artifact.status, 404);

  const first = await browser("screenshot", "quota-one", ["one.png"]);
  assert.equal(first.status, 200);
  const second = await browser("screenshot", "quota-two", ["two.png"]);
  assert.equal(second.status, 413);
  const stillHealthy = await browser("snapshot", "quota-two");
  assert.equal(stillHealthy.status, 200);
  await browser("close", "quota-one");
  await browser("close", "quota-two");
});

test("bounds the number of persisted sessions", async () => {
  const first = await browser("click", "limit-one", ["#button"]);
  assert.equal(first.status, 422);
  const second = await browser("click", "limit-two", ["#button"]);
  assert.equal(second.status, 422);
  const third = await browser("click", "limit-three", ["#button"]);
  assert.equal(third.status, 429);
  await browser("close", "limit-one");
  await browser("close", "limit-two");
  await assert.rejects(access(join(stateRoot, "limit-three")));
});

test("cleans timed-out and output-limited sessions", async () => {
  const childFailure = await browser("reload", "child-failure");
  assert.equal(childFailure.status, 502);
  await assert.rejects(access(join(stateRoot, "child-failure")));

  const timeout = await browser("open", "timeout-session", ["https://timeout.invalid"]);
  assert.equal(timeout.status, 504);
  await assert.rejects(access(join(stateRoot, "timeout-session")));

  const output = await browser("snapshot", "output-session", ["--compact"]);
  assert.equal(output.status, 413);
  await assert.rejects(access(join(stateRoot, "output-session")));
});
