import { expect, test } from "bun:test";
import { normalizeSessionTitle, SESSION_TITLE_MAX_LENGTH } from "./agent-protocol";
import { REQUEST_IMAGE_BASE64_BUDGET } from "./domain";
import {
	MAX_SERIALIZED_WS_REQUEST_BYTES,
	PROTOCOL_VERSION,
	WS_METHODS,
	type WsParams,
	type WsResult,
} from "./ws-protocol";

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

test("session lifecycle titles are normalized and bounded", () => {
	expect(normalizeSessionTitle("  Focused chat  ")).toBe("Focused chat");
	expect(() => normalizeSessionTitle("   ")).toThrow("cannot be empty");
	expect(() => normalizeSessionTitle(`bad\0title`)).toThrow("invalid character");
	expect(() => normalizeSessionTitle("x".repeat(SESSION_TITLE_MAX_LENGTH + 1))).toThrow(
		`${SESSION_TITLE_MAX_LENGTH} characters or fewer`,
	);
});

test("session fork is a typed project-scoped WebSocket method", () => {
	const params: WsParams<"session.fork"> = { projectId: "project", sessionId: "source" };
	expect(WS_METHODS.sessionFork).toBe("session.fork");
	expect(params).toEqual({ projectId: "project", sessionId: "source" });
});

test("extension and tool administration methods expose only browser-safe typed inputs and results", () => {
	const add: WsParams<"goose.extensionAdd"> = { name: "developer", enabled: true };
	const permission: WsParams<"session.toolPermissionSet"> = {
		projectId: "project",
		sessionId: "chat",
		toolName: "developer__shell",
		permission: "ask_before",
	};
	const catalog: WsResult<"goose.extensionList"> = {
		configured: [
			{ name: "developer", type: "builtin", enabled: true, configKey: "builtin.developer" },
		],
		available: [],
		warningCount: 1,
	};
	expect(PROTOCOL_VERSION).toBe(62);
	expect(WS_METHODS.gooseExtensionAdd).toBe("goose.extensionAdd");
	expect(add).toEqual({ name: "developer", enabled: true });
	expect(permission.permission).toBe("ask_before");
	expect(JSON.stringify(catalog)).not.toContain("raw");
	expect(JSON.stringify(catalog)).not.toContain("warning text");
});
