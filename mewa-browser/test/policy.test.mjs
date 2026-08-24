import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserPolicyError,
  screenshotFilename,
  validateBrowserRequest,
} from "../src/policy.mjs";

function rejected(body, code = "invalid_request") {
  assert.throws(
    () => validateBrowserRequest(body),
    (error) => error instanceof BrowserPolicyError && error.code === code,
  );
}

test("accepts a plain https navigation", () => {
  const request = validateBrowserRequest({
    session: "smoke",
    command: "open",
    args: ["https://example.com"],
  });
  assert.equal(request.command, "open");
});

test("rejects credentials and executable URL schemes", () => {
  rejected({ session: "smoke", command: "open", args: ["https://user:pass@example.com"] });
  rejected({ session: "smoke", command: "open", args: ["file:///etc/passwd"] });
  rejected({ session: "smoke", command: "open", args: ["javascript:alert(1)"] });
});

test("rejects arbitrary browser flags", () => {
  rejected({ session: "smoke", command: "open", args: ["--profile", "x", "https://example.com"] });
  rejected({ session: "smoke", command: "snapshot", args: ["--headers", "x"] });
  rejected({ session: "smoke", command: "screenshot", args: ["screen.png", "--full"] });
});

test("permits only command-specific options", () => {
  validateBrowserRequest({
    session: "smoke",
    command: "snapshot",
    args: ["--compact", "--depth", "3"],
  });
  rejected({ session: "smoke", command: "click", args: ["--depth", "3", "@e1"] });
});

test("enforces bounded wait, scroll, and viewport values", () => {
  validateBrowserRequest({ session: "smoke", command: "wait", args: ["30000"] });
  rejected({ session: "smoke", command: "wait", args: ["30001"] });
  validateBrowserRequest({ session: "smoke", command: "scroll", args: ["down", "300"] });
  rejected({ session: "smoke", command: "scroll", args: ["sideways"] });
  validateBrowserRequest({ session: "smoke", command: "set", args: ["viewport", "1280", "720"] });
  rejected({ session: "smoke", command: "set", args: ["viewport", "9999", "720"] });
});

test("screenshot requires a fresh simple image filename", () => {
  const request = validateBrowserRequest({
    session: "smoke",
    command: "screenshot",
    args: ["screen.png"],
  });
  assert.equal(screenshotFilename(request), "screen.png");
  rejected({ session: "smoke", command: "screenshot", args: ["../screen.png"] });
  rejected({ session: "smoke", command: "screenshot", args: ["screen.pdf"] });
});

test("rejects malformed sessions and unknown fields", () => {
  rejected({ session: "../x", command: "close", args: [] });
  rejected({ session: "x", command: "close", args: [], raw: true });
});

test("keeps the command set narrow and validates command arity", () => {
  rejected({ session: "smoke", command: "eval", args: ["document.body"] });
  rejected({ session: "smoke", command: "console", args: [] });
  rejected({ session: "smoke", command: "goto", args: ["https://example.com"] });
  rejected({ session: "smoke", command: "click", args: [] });
  rejected({ session: "smoke", command: "fill", args: ["#name"] });
  rejected({ session: "smoke", command: "snapshot", args: ["unexpected"] });
  rejected({ session: "smoke", command: "close", args: ["extra"] });
  validateBrowserRequest({ session: "smoke", command: "is", args: ["visible", "@e1"] });
  rejected({ session: "smoke", command: "is", args: ["visible"] });
  validateBrowserRequest({ session: "smoke", command: "get", args: ["text", "@e1"] });
  rejected({ session: "smoke", command: "get", args: ["text"] });
});
