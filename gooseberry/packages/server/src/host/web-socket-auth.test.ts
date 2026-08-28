import { describe, expect, test } from "bun:test";
import { ControllerAuth } from "../auth";
import {
	authorizeWebSocketUpgrade,
	isAllowedWebSocketOrigin,
	isAuthorizedHttpRequest,
	readAuthEnabled,
	readAuthMaxAgeDays,
	readWebSocketAuthConfig,
	validateAuthTokens,
} from "./web-socket-auth";

const token = "controller-token-0123456789abcdef0123456789";
const auth = new ControllerAuth({ token });
const session = auth.login(token) as string;
const config = readWebSocketAuthConfig(auth);

function request(headers: Record<string, string> = {}): Request {
	return new Request("http://controller.test:3141/ws", {
		headers: { host: "controller.test:3141", origin: "http://controller.test:3141", ...headers },
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
			GOOSEBERRY_PUBLIC_ORIGIN: "https://gooseberry.example.test",
		});
		const proxied = new Request("http://127.0.0.1:3141/ws", {
			headers: {
				host: "127.0.0.1:3141",
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
				GOOSEBERRY_PUBLIC_ORIGIN: "https://gooseberry.example.test/path",
			}),
		).toThrow("GOOSEBERRY_PUBLIC_ORIGIN");
	});
});

test("requires distinct strong controller and browser tokens and validates auth lifetime", () => {
	expect(
		validateAuthTokens({
			GOOSEBERRY_TOKEN: token,
			GOOSEBERRY_BROWSER_TOKEN: "browser-token-fedcba9876543210fedcba987654",
			GOOSEBERRY_AUTH_MAX_AGE_DAYS: "90",
		}),
	).toEqual({
		authenticationEnabled: true,
		controllerToken: token,
		browserToken: "browser-token-fedcba9876543210fedcba987654",
		authMaxAgeDays: 90,
	});
	expect(() => validateAuthTokens({})).toThrow("GOOSEBERRY_TOKEN");
	for (const value of ["", "0", "366", "1.5", "day"]) {
		expect(() => readAuthMaxAgeDays(value)).toThrow("GOOSEBERRY_AUTH_MAX_AGE_DAYS");
	}
	expect(readAuthMaxAgeDays(undefined)).toBe(180);
});

test("disables controller token validation only with the canonical false flag", () => {
	expect(
		validateAuthTokens({ GOOSEBERRY_AUTH_ENABLED: "false", GOOSEBERRY_TOKEN: "short" }),
	).toEqual({
		authenticationEnabled: false,
		authMaxAgeDays: 180,
	});
	expect(readAuthEnabled(undefined)).toBe(true);
	expect(readAuthEnabled("false")).toBe(false);
	for (const value of ["False", "0", " true", ""]) {
		expect(() => readAuthEnabled(value)).toThrow("GOOSEBERRY_AUTH_ENABLED");
	}
});

test("disabled authentication permits only same-origin private traffic", () => {
	const disabled = readWebSocketAuthConfig(undefined, { GOOSEBERRY_AUTH_ENABLED: "false" });
	expect(authorizeWebSocketUpgrade(request({ "sec-fetch-site": "same-origin" }), disabled)).toEqual(
		{ sessionExpiresAt: undefined },
	);
	expect(
		authorizeWebSocketUpgrade(
			request({ origin: "http://foreign.test:3141", "sec-fetch-site": "same-origin" }),
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
