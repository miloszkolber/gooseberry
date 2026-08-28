import { expect, test } from "bun:test";
import { MAX_SERIALIZED_WS_REQUEST_BYTES } from "@gooseberry/contracts";
import { isWebSocketPayloadWithinLimit } from "./server";

test("WebSocket payload validation counts bytes and rejects an oversized frame", () => {
	const oversized = new Uint8Array(MAX_SERIALIZED_WS_REQUEST_BYTES + 1);
	expect(isWebSocketPayloadWithinLimit(oversized.subarray(0, -1))).toBe(true);
	expect(isWebSocketPayloadWithinLimit(oversized)).toBe(false);
	expect(isWebSocketPayloadWithinLimit("💡")).toBe(true);
});
