import { expect, test } from "bun:test";
import {
	normalizeSessionTitle,
	SESSION_TITLE_MAX_LENGTH,
} from "../../contracts/src/agent-protocol";
import { REQUEST_IMAGE_BASE64_BUDGET } from "../../contracts/src/domain";
import {
	MAX_SERIALIZED_WS_REQUEST_BYTES,
	PROTOCOL_VERSION,
	WS_METHODS,
	type WsParams,
	type WsResult,
} from "../../contracts/src/ws-protocol";

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

test("Git branch comparisons use an explicit typed base", () => {
	const params: WsParams<"git.listBranches"> = {
		projectId: "project",
		repository: "/project",
	};
	const result: WsResult<"git.listBranches"> = {
		branches: [{ ref: "refs/heads/main", name: "main" }],
		truncated: false,
	};
	expect(WS_METHODS.gitListBranches).toBe("git.listBranches");
	expect(params.repository).toBe("/project");
	expect(result.branches[0]?.ref).toBe("refs/heads/main");
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
	expect(PROTOCOL_VERSION).toBe(72);
	expect(WS_METHODS.gooseExtensionAdd).toBe("goose.extensionAdd");
	expect(add).toEqual({ name: "developer", enabled: true });
	expect(permission.permission).toBe("ask_before");
	expect(JSON.stringify(catalog)).not.toContain("raw");
	expect(JSON.stringify(catalog)).not.toContain("warning text");
});

test("interactive App operations are view-scoped and cancellable", () => {
	const content: WsParams<"session.appContentRead"> = {
		projectId: "project",
		sessionId: "chat",
		toolCallId: "call",
		viewId: "view",
		offset: 0,
	};
	const resource: WsParams<"session.appResourceRead"> = {
		projectId: "project",
		sessionId: "chat",
		toolCallId: "call",
		viewId: "view",
		operationId: "operation",
		uri: "ui://example/resource",
	};
	const tool: WsParams<"session.appToolCall"> = {
		projectId: "project",
		sessionId: "chat",
		toolCallId: "call",
		viewId: "view",
		operationId: "operation",
		name: "example__tool",
	};
	const cancel: WsParams<"session.appOperationCancel"> = {
		viewId: "view",
		operationId: "operation",
	};

	expect(WS_METHODS.sessionAppOperationCancel).toBe("session.appOperationCancel");
	expect(WS_METHODS.sessionAppContentRead).toBe("session.appContentRead");
	expect(content.offset).toBe(0);
	expect(resource).toMatchObject(cancel);
	expect(tool).toMatchObject(cancel);
});

test("agent mentions and provider readiness use browser-safe typed protocol surfaces", () => {
	const mentions: WsResult<"session.getAgentMentions"> = [
		{
			name: "Reviewer",
			description: "Review the change",
			sourceType: "agent",
			mention: "@reviewer",
		},
	];
	const readiness: WsResult<"provider.readiness"> = {
		providerId: "openai",
		ready: false,
		hasIssue: true,
	};
	expect(WS_METHODS.sessionGetAgentMentions).toBe("session.getAgentMentions");
	expect(WS_METHODS.providerReadiness).toBe("provider.readiness");
	expect(JSON.stringify(mentions)).not.toContain("sourcePath");
	expect(JSON.stringify(readiness)).not.toContain("error");
});
