import { describe, expect, test } from "bun:test";
import { encodeCodeTokenProtocol } from "@mewa-code/contracts";
import {
	authorizeWebSocketUpgrade,
	isAllowedWebSocketOrigin,
	isAuthorizedHttpRequest,
	readWebSocketAuthConfig,
	validateAuthTokens,
} from "./webSocketAuth";

const codeToken = "controller-token-0123456789abcdef0123456789";
const browserToken = "browser-token-fedcba9876543210fedcba987654";
const config = readWebSocketAuthConfig({
	MEWA_CODE_TOKEN: codeToken,
	MEWA_BROWSER_TOKEN: browserToken,
	MEWA_CODE_ALLOWED_ORIGINS: "http://allowed.test:24242",
});
const protocol = encodeCodeTokenProtocol(codeToken) as string;

function wsRequest(headers: Record<string, string> = {}): Request {
	return new Request("http://controller.test:24242/ws", {
		headers: {
			host: "controller.test:24242",
			origin: "http://controller.test:24242",
			"sec-websocket-protocol": protocol,
			...headers,
		},
	});
}

describe("controller WebSocket authentication", () => {
	test("rejects short and documented sentinel tokens before listening", () => {
		expect(() =>
			validateAuthTokens({
				MEWA_CODE_TOKEN: "short-controller-token",
				MEWA_BROWSER_TOKEN: browserToken,
			}),
		).toThrow("MEWA_CODE_TOKEN");
		expect(() =>
			validateAuthTokens({
				MEWA_CODE_TOKEN: "INVALID_REPLACE_WITH_RANDOM_CONTROLLER_TOKEN",
				MEWA_BROWSER_TOKEN: browserToken,
			}),
		).toThrow("MEWA_CODE_TOKEN");
		expect(() =>
			validateAuthTokens({
				MEWA_CODE_TOKEN: codeToken,
				MEWA_BROWSER_TOKEN: "INVALID_REPLACE_WITH_RANDOM_BROWSER_TOKEN",
			}),
		).toThrow("MEWA_BROWSER_TOKEN");
	});

	test("accepts two strong independent tokens", () => {
		expect(
			validateAuthTokens({ MEWA_CODE_TOKEN: codeToken, MEWA_BROWSER_TOKEN: browserToken }),
		).toEqual({
			controllerToken: codeToken,
			browserToken,
		});
	});

	test("fails closed when the controller and browser tokens are not distinct", () => {
		const sameToken = readWebSocketAuthConfig({
			MEWA_CODE_TOKEN: codeToken,
			MEWA_BROWSER_TOKEN: codeToken,
		});
		const result = authorizeWebSocketUpgrade(wsRequest(), sameToken);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(503);
	});

	test("rejects a missing token before any dispatch", () => {
		let dispatched = false;
		const result = authorizeWebSocketUpgrade(wsRequest({ "sec-websocket-protocol": "" }), config);
		if (!(result instanceof Response)) dispatched = true;

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
		expect(dispatched).toBe(false);
	});

	test("rejects a wrong token before any dispatch", () => {
		const wrongProtocol = encodeCodeTokenProtocol(
			"wrong-controller-token-0123456789abcdef",
		) as string;
		const result = authorizeWebSocketUpgrade(
			wsRequest({ "sec-websocket-protocol": wrongProtocol }),
			config,
		);

		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	test("accepts the correct token and returns the negotiated protocol", () => {
		const result = authorizeWebSocketUpgrade(wsRequest(), config);

		expect(result).not.toBeInstanceOf(Response);
		expect(result).toEqual({
			protocol,
			setCookie: expect.stringContaining("mewa_code_auth="),
		});
	});
});

describe("controller WebSocket Origin/Host policy", () => {
	test("allows the same origin and an explicitly configured private origin", () => {
		expect(isAllowedWebSocketOrigin(wsRequest(), config.allowedOrigins)).toBe(true);
		expect(
			isAllowedWebSocketOrigin(
				wsRequest({ origin: "http://allowed.test:24242" }),
				config.allowedOrigins,
			),
		).toBe(true);
	});

	test("rejects missing and foreign origins", () => {
		expect(isAllowedWebSocketOrigin(wsRequest({ origin: "" }), config.allowedOrigins)).toBe(false);
		expect(
			isAllowedWebSocketOrigin(
				wsRequest({ origin: "http://foreign.test:24242" }),
				config.allowedOrigins,
			),
		).toBe(false);
		expect(authorizeWebSocketUpgrade(wsRequest({ origin: "" }), config)).toBeInstanceOf(Response);
		expect((authorizeWebSocketUpgrade(wsRequest({ origin: "" }), config) as Response).status).toBe(
			403,
		);
	});
});

describe("HTTP controller reads", () => {
	test("require the controller token and accept only a bearer token or its session cookie", () => {
		expect(isAuthorizedHttpRequest(new Request("http://controller.test/files/x"), config)).toBe(
			false,
		);
		expect(
			isAuthorizedHttpRequest(
				new Request("http://controller.test/files/x", {
					headers: { authorization: "Bearer wrong-secret" },
				}),
				config,
			),
		).toBe(false);
		expect(
			isAuthorizedHttpRequest(
				new Request("http://controller.test/files/x", {
					headers: { authorization: `Bearer ${codeToken}` },
				}),
				config,
			),
		).toBe(true);

		const upgrade = authorizeWebSocketUpgrade(wsRequest(), config);
		if (upgrade instanceof Response) throw new Error("expected an authorized upgrade");
		const cookie = upgrade.setCookie.split(";", 1)[0] as string;
		expect(
			isAuthorizedHttpRequest(
				new Request("http://controller.test/files/x", {
					headers: { cookie, "sec-fetch-site": "same-origin" },
				}),
				config,
			),
		).toBe(true);
	});
});
