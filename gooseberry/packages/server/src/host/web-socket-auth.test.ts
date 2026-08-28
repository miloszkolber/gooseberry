import { describe, expect, test } from "bun:test";
import { ControllerAuth } from "../auth";
import {
	authorizeWebSocketUpgrade,
	isAllowedWebSocketOrigin,
	isAuthorizedHttpRequest,
	readAuthEnabled,
	readBrowserAuthEnabled,
	readWebSocketAuthConfig,
	validateAuthTokens,
} from "./web-socket-auth";

const token = "controller-token-0123456789abcdef0123456789";
const auth = new ControllerAuth({ token });
const session = auth.login(token) as string;
const config = readWebSocketAuthConfig(auth, { GOOSEBERRY_AUTH_ENABLED: "true" });

function request(headers: Record<string, string> = {}): Request {
	return new Request("http://controller.test:7312/ws", {
		headers: { host: "controller.test:7312", origin: "http://controller.test:7312", ...headers },
	});
}

describe("controller cookie authentication", () => {
	test("accepts only a same-origin durable cookie for private traffic", () => {
		expect(
			authorizeWebSocketUpgrade(request({ cookie: `gooseberry_auth=${session}` }), config),
		).toEqual({
			sessionExpiresAt: auth.sessionExpiresAt(session),
		});
		expect(authorizeWebSocketUpgrade(request(), config)).toMatchObject({ status: 401 });
		expect(
			isAuthorizedHttpRequest(
				new Request("http://controller.test/files/x", {
					headers: { authorization: "Bearer ignored", "sec-fetch-site": "same-origin" },
				}),
				config,
			),
		).toBe(false);
		expect(
			isAuthorizedHttpRequest(
				new Request("http://controller.test/files/x", {
					headers: { cookie: `gooseberry_auth=${session}`, "sec-fetch-site": "cross-site" },
				}),
				config,
			),
		).toBe(false);
	});

	test("uses explicit public HTTPS origin without trusting forwarded headers", () => {
		const proxyConfig = readWebSocketAuthConfig(auth, {
			GOOSEBERRY_AUTH_ENABLED: "true",
			GOOSEBERRY_PUBLIC_ORIGIN: "https://gooseberry.example.test",
		});
		const proxied = new Request("http://127.0.0.1:7312/ws", {
			headers: {
				host: "127.0.0.1:7312",
				origin: "https://gooseberry.example.test",
				cookie: `gooseberry_auth=${session}`,
				"x-forwarded-proto": "http",
			},
		});
		expect(isAllowedWebSocketOrigin(proxied, proxyConfig)).toBe(true);
		expect(authorizeWebSocketUpgrade(proxied, proxyConfig)).toEqual({
			sessionExpiresAt: auth.sessionExpiresAt(session),
		});
		expect(() =>
			readWebSocketAuthConfig(auth, {
				GOOSEBERRY_AUTH_ENABLED: "true",
				GOOSEBERRY_PUBLIC_ORIGIN: "https://gooseberry.example.test/path",
			}),
		).toThrow("GOOSEBERRY_PUBLIC_ORIGIN");
	});
});

test("requires distinct strong controller and authenticated browser tokens", () => {
	expect(
		validateAuthTokens({
			GOOSEBERRY_AUTH_ENABLED: "true",
			GOOSEBERRY_TOKEN: token,
			GOOSEBERRY_BROWSER_AUTH: "true",
			GOOSEBERRY_BROWSER_TOKEN: "browser-token-fedcba9876543210fedcba987654",
		}),
	).toEqual({
		authenticationEnabled: true,
		controllerToken: token,
		browserToken: "browser-token-fedcba9876543210fedcba987654",
		browserAuthenticationEnabled: true,
	});
	expect(() => validateAuthTokens({ GOOSEBERRY_AUTH_ENABLED: "true" })).toThrow("GOOSEBERRY_TOKEN");
	expect(() => validateAuthTokens({ GOOSEBERRY_BROWSER_AUTH: "true" })).toThrow(
		"GOOSEBERRY_BROWSER_TOKEN",
	);
});

test("disables controller token validation only with the canonical false flag", () => {
	expect(
		validateAuthTokens({ GOOSEBERRY_AUTH_ENABLED: "false", GOOSEBERRY_TOKEN: "short" }),
	).toEqual({
		authenticationEnabled: false,
		browserAuthenticationEnabled: false,
	});
	expect(readAuthEnabled(undefined)).toBe(false);
	expect(readAuthEnabled("false")).toBe(false);
	for (const value of ["False", "0", " true", ""]) {
		expect(() => readAuthEnabled(value)).toThrow("GOOSEBERRY_AUTH_ENABLED");
	}
	expect(readBrowserAuthEnabled(undefined)).toBe(false);
	expect(readBrowserAuthEnabled("true")).toBe(true);
	expect(() => readBrowserAuthEnabled("1")).toThrow("GOOSEBERRY_BROWSER_AUTH");
});

test("disabled authentication permits only same-origin private traffic", () => {
	const disabled = readWebSocketAuthConfig(undefined, { GOOSEBERRY_AUTH_ENABLED: "false" });
	expect(authorizeWebSocketUpgrade(request({ "sec-fetch-site": "same-origin" }), disabled)).toEqual(
		{ sessionExpiresAt: undefined },
	);
	expect(
		authorizeWebSocketUpgrade(
			request({ origin: "http://foreign.test:7312", "sec-fetch-site": "same-origin" }),
			disabled,
		),
	).toMatchObject({ status: 403 });
	expect(
		isAuthorizedHttpRequest(
			new Request("http://controller.test/files/x", {
				headers: {
					host: "controller.test",
					"sec-fetch-site": "same-origin",
				},
			}),
			disabled,
		),
	).toBe(true);
	expect(
		isAuthorizedHttpRequest(
			new Request("http://controller.test/files/x", {
				headers: { host: "controller.test", "sec-fetch-site": "cross-site" },
			}),
			disabled,
		),
	).toBe(false);
});
