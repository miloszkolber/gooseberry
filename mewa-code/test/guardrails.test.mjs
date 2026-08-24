import assert from "node:assert/strict";
import test from "node:test";
import {
  default as mewaGuardrails,
  parseRestrictedPaths,
  pathOverlapsRoot,
  shellPathCandidates,
} from "../dist/pi/extensions/mewa-guardrails.js";

test("restricted paths must be absolute and are deduplicated", () => {
  assert.deepEqual(parseRestrictedPaths("/home/data:/home/data:/run/secrets"), [
    "/home/data",
    "/run/secrets",
  ]);
  assert.throws(() => parseRestrictedPaths("relative"), /must be absolute/);
});

test("path overlap distinguishes direct access from recursive traversal", () => {
  assert.equal(pathOverlapsRoot("/home/data/pi", "/home/data"), true);
  assert.equal(pathOverlapsRoot("/home", "/home/data", false), false);
  assert.equal(pathOverlapsRoot("/home", "/home/data", true), true);
  assert.equal(pathOverlapsRoot("/workspace", "/home/data", true), false);
});

test("shell candidate extraction resolves quoted and relative path words", () => {
  assert.deepEqual(
    shellPathCandidates("cat '/home/data/pi/auth.json' && ls ../private", "/workspace/project"),
    ["/home/data/pi/auth.json", "/workspace/private"],
  );
});

test("registered guard blocks direct and visible shell access", async () => {
  const previous = process.env.MEWA_RESTRICTED_PATHS;
  process.env.MEWA_RESTRICTED_PATHS = "/tmp/opencode/guard-test-secret";
  let handler;
  mewaGuardrails({
    on(event, candidate) {
      if (event === "tool_call") handler = candidate;
    },
  });
  try {
    const context = { cwd: "/workspace", hasUI: false };
    assert.equal(
      (await handler({ toolName: "read", input: { path: "/tmp/opencode/guard-test-secret/token" } }, context)).block,
      true,
    );
    assert.equal(
      (await handler({ toolName: "bash", input: { command: "cat /tmp/opencode/guard-test-secret/token" } }, context)).block,
      true,
    );
    assert.equal(await handler({ toolName: "read", input: { path: "/workspace/README.md" } }, context), undefined);
  } finally {
    if (previous === undefined) delete process.env.MEWA_RESTRICTED_PATHS;
    else process.env.MEWA_RESTRICTED_PATHS = previous;
  }
});
