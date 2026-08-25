import assert from "node:assert/strict";
import test from "node:test";
import {
  TOKEN_MIN_LENGTH,
  TOKEN_SENTINELS,
  assertStrongToken,
  isStrongToken,
} from "../src/token.mjs";

const strongToken = "browser-token-0123456789abcdef0123456789";

test("rejects short tokens", () => {
  assert.equal(isStrongToken("x".repeat(TOKEN_MIN_LENGTH - 1)), false);
  assert.throws(() => assertStrongToken("short"), /at least 32/);
});

test("rejects documented sentinels", () => {
  for (const sentinel of TOKEN_SENTINELS) assert.equal(isStrongToken(sentinel), false);
});

test("accepts a strong printable token", () => {
  assert.equal(isStrongToken(strongToken), true);
  assert.doesNotThrow(() => assertStrongToken(strongToken));
});
