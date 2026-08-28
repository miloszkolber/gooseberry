import { expect, test } from "bun:test";
import { REQUEST_IMAGE_BASE64_BUDGET } from "./domain";
import { MAX_SERIALIZED_WS_REQUEST_BYTES } from "./ws-protocol";

test("the WebSocket envelope fits the accepted aggregate image budget", () => {
	const request = JSON.stringify({
		id: "request-id",
		method: "session.prompt",
		params: {
			sessionId: "session-id",
			text: "",
			images: [
				{ type: "image", mimeType: "image/png", data: "A".repeat(REQUEST_IMAGE_BASE64_BUDGET) },
			],
		},
	});

	expect(Buffer.byteLength(request)).toBeGreaterThan(REQUEST_IMAGE_BASE64_BUDGET);
	expect(Buffer.byteLength(request)).toBeLessThanOrEqual(MAX_SERIALIZED_WS_REQUEST_BYTES);
});
