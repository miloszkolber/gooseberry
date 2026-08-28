import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SERIALIZED_WS_REQUEST_BYTES } from "@gooseberry/contracts";
import { assertCanonicalStateLayout, isWebSocketPayloadWithinLimit } from "./server";

test("WebSocket payload validation counts bytes and rejects an oversized frame", () => {
	const oversized = new Uint8Array(MAX_SERIALIZED_WS_REQUEST_BYTES + 1);
	expect(isWebSocketPayloadWithinLimit(oversized.subarray(0, -1))).toBe(true);
	expect(isWebSocketPayloadWithinLimit(oversized)).toBe(false);
	expect(isWebSocketPayloadWithinLimit("💡")).toBe(true);
});

test("refuses a legacy Pixie state mount", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "gooseberry-state-"));
	try {
		mkdirSync(join(stateRoot, "pixie"));
		expect(() => assertCanonicalStateLayout({ GOOSEBERRY_STATE_ROOT: stateRoot })).toThrow(
			"Legacy Pixie",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
