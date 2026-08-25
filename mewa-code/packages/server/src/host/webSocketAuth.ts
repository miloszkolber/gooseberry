import { createHash, timingSafeEqual } from "node:crypto";
import {
	CODE_TOKEN_MAX_LENGTH,
	CODE_TOKEN_MIN_LENGTH,
	decodeCodeTokenProtocol,
	isCodeToken,
} from "@mewa-code/contracts";

export const CODE_AUTH_COOKIE = "mewa_code_auth";
export const MAX_AUTH_HEADER_LENGTH = 4096;
export const MAX_ORIGIN_LENGTH = 512;
export const MAX_HOST_LENGTH = 255;

const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;
const AUTH_COOKIE_VALUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthEnvironment {
	readonly MEWA_CODE_TOKEN?: string;
	readonly MEWA_BROWSER_TOKEN?: string;
	readonly MEWA_CODE_ALLOWED_ORIGINS?: string;
}

export interface WebSocketAuthConfig {
	readonly token: string | undefined;
	readonly allowedOrigins: ReadonlySet<string>;
	readonly cookieValue: string | undefined;
}

export interface AuthorizedWebSocketUpgrade {
	readonly protocol: string;
	readonly setCookie: string;
}

export interface AuthTokenPair {
	readonly controllerToken: string;
	readonly browserToken: string;
}

/** Validate both service tokens before a controller listener is created. */
export function validateAuthTokens(
	env: AuthEnvironment = process.env as AuthEnvironment,
): AuthTokenPair {
	if (!isCodeToken(env.MEWA_CODE_TOKEN)) {
		throw new Error(
			`MEWA_CODE_TOKEN must be at least ${CODE_TOKEN_MIN_LENGTH} printable random-token characters`,
		);
	}
	if (!isCodeToken(env.MEWA_BROWSER_TOKEN)) {
		throw new Error(
			`MEWA_BROWSER_TOKEN must be at least ${CODE_TOKEN_MIN_LENGTH} printable random-token characters`,
		);
	}
	if (env.MEWA_CODE_TOKEN === env.MEWA_BROWSER_TOKEN) {
		throw new Error("MEWA_CODE_TOKEN and MEWA_BROWSER_TOKEN must be different");
	}
	return { controllerToken: env.MEWA_CODE_TOKEN, browserToken: env.MEWA_BROWSER_TOKEN };
}

function cookieValueForToken(token: string): string {
	return createHash("sha256").update("mewa-code-http-cookie\0").update(token).digest("base64url");
}

function parseAllowedOrigins(raw: string | undefined): ReadonlySet<string> {
	const origins = new Set<string>();
	if (!raw) return origins;
	for (const candidate of raw.split(",")) {
		const origin = normalizeOrigin(candidate.trim());
		if (origin) origins.add(origin);
	}
	return origins;
}

export function readWebSocketAuthConfig(
	env: AuthEnvironment = process.env as AuthEnvironment,
): WebSocketAuthConfig {
	const token =
		isCodeToken(env.MEWA_CODE_TOKEN) &&
		isCodeToken(env.MEWA_BROWSER_TOKEN) &&
		env.MEWA_CODE_TOKEN !== env.MEWA_BROWSER_TOKEN
			? env.MEWA_CODE_TOKEN
			: undefined;
	return {
		token,
		allowedOrigins: parseAllowedOrigins(env.MEWA_CODE_ALLOWED_ORIGINS),
		...(token ? { cookieValue: cookieValueForToken(token) } : { cookieValue: undefined }),
	};
}

export function normalizeOrigin(value: string): string | undefined {
	if (!value || value.length > MAX_ORIGIN_LENGTH || value.trim() !== value) return undefined;
	try {
		const url = new URL(value);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			!url.hostname
		)
			return undefined;
		return url.origin;
	} catch {
		return undefined;
	}
}

function normalizeHost(value: string): string | undefined {
	if (!value || value.length > MAX_HOST_LENGTH || value.trim() !== value || /[\s,]/.test(value)) {
		return undefined;
	}
	try {
		const url = new URL(`http://${value}`);
		if (
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			!url.hostname ||
			url.host !== value.toLowerCase()
		)
			return undefined;
		return url.host;
	} catch {
		return undefined;
	}
}

export function isAllowedWebSocketOrigin(
	req: Request,
	allowedOrigins: ReadonlySet<string>,
): boolean {
	const hostHeader = req.headers.get("host");
	if (!hostHeader) return false;
	const host = normalizeHost(hostHeader);
	if (!host) return false;

	let requestUrl: URL;
	try {
		requestUrl = new URL(req.url);
	} catch {
		return false;
	}
	if (
		(requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") ||
		requestUrl.host !== host
	)
		return false;

	const originHeader = req.headers.get("origin");
	if (!originHeader || originHeader.length > MAX_ORIGIN_LENGTH) return false;
	const origin = normalizeOrigin(originHeader);
	if (!origin) return false;
	return origin === requestUrl.origin || allowedOrigins.has(origin);
}

function constantTimeTokenEqual(expected: string, actual: string): boolean {
	const expectedDigest = createHash("sha256").update(expected).digest();
	const actualDigest = createHash("sha256").update(actual).digest();
	return timingSafeEqual(expectedDigest, actualDigest) && expected.length === actual.length;
}

function readBearerToken(req: Request): string | undefined {
	const value = req.headers.get("authorization");
	if (!value || value.length > MAX_AUTH_HEADER_LENGTH) return undefined;
	const match = /^Bearer ([\x21-\x7e]+)$/.exec(value);
	const token = match?.[1];
	return token && token.length <= CODE_TOKEN_MAX_LENGTH ? token : undefined;
}

function readCookie(req: Request, name: string): string | undefined {
	const value = req.headers.get("cookie");
	if (!value || value.length > MAX_AUTH_HEADER_LENGTH) return undefined;
	let found: string | undefined;
	for (const part of value.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0) continue;
		const key = part.slice(0, separator).trim();
		if (key !== name) continue;
		if (found !== undefined) return undefined;
		found = part.slice(separator + 1).trim();
	}
	return found;
}

/** Authenticate HTTP file/artifact reads without putting the token in a URL. */
export function isAuthorizedHttpRequest(req: Request, config: WebSocketAuthConfig): boolean {
	if (!config.token || !config.cookieValue) return false;
	const bearer = readBearerToken(req);
	if (bearer && constantTimeTokenEqual(config.token, bearer)) return true;
	const cookie = readCookie(req, CODE_AUTH_COOKIE);
	return (
		cookie !== undefined &&
		AUTH_COOKIE_VALUE_PATTERN.test(cookie) &&
		req.headers.get("sec-fetch-site") === "same-origin" &&
		(!req.headers.get("origin") || isAllowedWebSocketOrigin(req, config.allowedOrigins)) &&
		constantTimeTokenEqual(config.cookieValue, cookie)
	);
}

function rejection(status: number, message: string): Response {
	return new Response(message, {
		status,
		headers: {
			"cache-control": "no-store",
			"content-type": "text/plain; charset=utf-8",
		},
	});
}

/** Validate Origin/Host and the negotiated token before Bun upgrades the socket. */
export function authorizeWebSocketUpgrade(
	req: Request,
	config: WebSocketAuthConfig,
): AuthorizedWebSocketUpgrade | Response {
	if (!config.token) return rejection(503, "controller authentication unavailable");
	if (!isAllowedWebSocketOrigin(req, config.allowedOrigins)) return rejection(403, "forbidden");

	const protocolHeader = req.headers.get("sec-websocket-protocol");
	if (
		!protocolHeader ||
		protocolHeader.length > MAX_AUTH_HEADER_LENGTH ||
		protocolHeader.includes(",")
	) {
		return rejection(401, "unauthorized");
	}
	const protocol = protocolHeader.trim() === protocolHeader ? protocolHeader : "";
	const token = decodeCodeTokenProtocol(protocol);
	if (!token || !constantTimeTokenEqual(config.token, token)) return rejection(401, "unauthorized");
	let secureCookie = "";
	try {
		secureCookie = new URL(req.url).protocol === "https:" ? "; Secure" : "";
	} catch {}

	return {
		protocol,
		setCookie: `${CODE_AUTH_COOKIE}=${config.cookieValue}; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Strict${secureCookie}`,
	};
}
