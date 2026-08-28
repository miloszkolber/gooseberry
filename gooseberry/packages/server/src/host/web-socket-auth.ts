import { timingSafeEqual } from "node:crypto";
import { CONTROLLER_AUTH_COOKIE, type ControllerAuth } from "../auth";

export { CONTROLLER_AUTH_COOKIE as CODE_AUTH_COOKIE } from "../auth";
export const MAX_AUTH_HEADER_LENGTH = 4096;
export const MAX_ORIGIN_LENGTH = 512;
export const MAX_HOST_LENGTH = 255;

export interface AuthEnvironment {
	readonly GOOSEBERRY_AUTH_ENABLED?: string;
	readonly GOOSEBERRY_TOKEN?: string;
	readonly GOOSEBERRY_BROWSER_TOKEN?: string;
	readonly GOOSEBERRY_BROWSER_AUTH?: string;
	/** Rejected legacy configuration, retained only for a clear startup error. */
	readonly GOOSEBERRY_ALLOWED_ORIGINS?: string;
	readonly GOOSEBERRY_PUBLIC_ORIGIN?: string;
}

export interface WebSocketAuthConfig {
	readonly auth: ControllerAuth | undefined;
	readonly authenticationEnabled: boolean;
	readonly publicOrigin: string | undefined;
}

export type WebSocketUpgradeAuthorization =
	| { readonly sessionExpiresAt: number | undefined }
	| Response;

export interface AuthTokenPair {
	readonly authenticationEnabled: boolean;
	readonly controllerToken?: string;
	readonly browserToken?: string;
	readonly browserAuthenticationEnabled: boolean;
}

/** GOOSEBERRY_TOKEN is the required human controller credential, never a bearer request credential. */
export function validateAuthTokens(
	env: AuthEnvironment = process.env as AuthEnvironment,
): AuthTokenPair {
	const authenticationEnabled = readAuthEnabled(env.GOOSEBERRY_AUTH_ENABLED);
	const browserAuthenticationEnabled = readBrowserAuthEnabled(env.GOOSEBERRY_BROWSER_AUTH);
	const controllerToken = env.GOOSEBERRY_TOKEN?.trim();
	const browserToken = env.GOOSEBERRY_BROWSER_TOKEN?.trim();
	if (authenticationEnabled && (!controllerToken || !isStrongToken(controllerToken))) {
		throw new Error("GOOSEBERRY_TOKEN must be a strong printable random token");
	}
	if (browserAuthenticationEnabled && (!browserToken || !isStrongToken(browserToken))) {
		throw new Error("GOOSEBERRY_BROWSER_TOKEN must be a strong printable random token");
	}
	if (
		authenticationEnabled &&
		controllerToken &&
		browserAuthenticationEnabled &&
		browserToken &&
		constantTimeEqual(controllerToken, browserToken)
	) {
		throw new Error("GOOSEBERRY_TOKEN and GOOSEBERRY_BROWSER_TOKEN must be different");
	}
	return {
		authenticationEnabled,
		...(authenticationEnabled && controllerToken ? { controllerToken } : {}),
		...(browserAuthenticationEnabled && browserToken ? { browserToken } : {}),
		browserAuthenticationEnabled,
	};
}

export function readAuthEnabled(value: string | undefined): boolean {
	if (value === undefined) return false;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error("GOOSEBERRY_AUTH_ENABLED must be exactly true or false");
}

export function readBrowserAuthEnabled(value: string | undefined): boolean {
	if (value === undefined) return false;
	if (value === "true") return true;
	if (value === "false") return false;
	throw new Error("GOOSEBERRY_BROWSER_AUTH must be exactly true or false");
}

function isStrongToken(value: string): boolean {
	return (
		value.length >= 32 &&
		value.length <= 256 &&
		/^[\x21-\x7e]+$/.test(value) &&
		!value.startsWith("INVALID_REPLACE_WITH_RANDOM_") &&
		!value.startsWith("replace-with-a-random-")
	);
}

function constantTimeEqual(left: string, right: string): boolean {
	const a = Buffer.from(left);
	const b = Buffer.from(right);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function readWebSocketAuthConfig(
	auth: ControllerAuth | undefined,
	env: AuthEnvironment = process.env as AuthEnvironment,
): WebSocketAuthConfig {
	const authenticationEnabled = readAuthEnabled(env.GOOSEBERRY_AUTH_ENABLED);
	if (authenticationEnabled && !auth)
		throw new Error("GOOSEBERRY_TOKEN authentication is not configured");
	if (env.GOOSEBERRY_ALLOWED_ORIGINS?.trim()) {
		throw new Error(
			"GOOSEBERRY_ALLOWED_ORIGINS is unsupported with cookie authentication. Use GOOSEBERRY_PUBLIC_ORIGIN.",
		);
	}
	const publicRaw = env.GOOSEBERRY_PUBLIC_ORIGIN?.trim();
	const publicOrigin = publicRaw ? normalizeOrigin(publicRaw) : undefined;
	if (publicRaw && !publicOrigin) {
		throw new Error("GOOSEBERRY_PUBLIC_ORIGIN must be an absolute http(s) origin without a path");
	}
	return { auth, authenticationEnabled, publicOrigin };
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
		return url.hostname && url.host === value.toLowerCase() ? url.host : undefined;
	} catch {
		return undefined;
	}
}

function directRequestOrigin(req: Request): string | undefined {
	const host = normalizeHost(req.headers.get("host") ?? "");
	if (!host) return undefined;
	try {
		const url = new URL(req.url);
		return url.host === host ? url.origin : undefined;
	} catch {
		return undefined;
	}
}

export function isExpectedOrigin(req: Request, config: WebSocketAuthConfig): boolean {
	const origin = normalizeOrigin(req.headers.get("origin") ?? "");
	if (!origin) return false;
	const expected = config.publicOrigin ?? directRequestOrigin(req);
	return origin === expected;
}

export function isAllowedWebSocketOrigin(req: Request, config: WebSocketAuthConfig): boolean {
	return isExpectedOrigin(req, config);
}

export function isSecureRequest(req: Request, config: WebSocketAuthConfig): boolean {
	if (config.publicOrigin) return config.publicOrigin.startsWith("https:");
	try {
		return new URL(req.url).protocol === "https:";
	} catch {
		return false;
	}
}

export function readAuthCookie(req: Request): string | undefined {
	const value = req.headers.get("cookie");
	if (!value || value.length > MAX_AUTH_HEADER_LENGTH) return undefined;
	let found: string | undefined;
	for (const part of value.split(";")) {
		const separator = part.indexOf("=");
		if (separator <= 0 || part.slice(0, separator).trim() !== CONTROLLER_AUTH_COOKIE) continue;
		if (found !== undefined) return undefined;
		found = part.slice(separator + 1).trim();
	}
	return found;
}

/** Private reads use durable cookies when enabled, otherwise strict browser same-origin signals. */
export function isAuthorizedHttpRequest(req: Request, config: WebSocketAuthConfig): boolean {
	if (config.authenticationEnabled && !config.auth?.isSession(readAuthCookie(req))) return false;
	const fetchSite = req.headers.get("sec-fetch-site");
	if (config.authenticationEnabled) {
		if (fetchSite && fetchSite !== "same-origin") return false;
	} else {
		if (fetchSite !== "same-origin" || !directRequestOrigin(req)) return false;
	}
	const origin = req.headers.get("origin");
	return !origin || isExpectedOrigin(req, config);
}

function rejection(status: number, message: string): Response {
	return new Response(message, {
		status,
		headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
	});
}

/** Validate Origin/Host and a durable cookie session before Bun upgrades the socket. */
export function authorizeWebSocketUpgrade(
	req: Request,
	config: WebSocketAuthConfig,
): WebSocketUpgradeAuthorization {
	if (!isAllowedWebSocketOrigin(req, config)) return rejection(403, "forbidden");
	if (!config.authenticationEnabled) {
		return { sessionExpiresAt: undefined };
	}
	const sessionExpiresAt = config.auth?.sessionExpiresAt(readAuthCookie(req));
	return sessionExpiresAt === undefined ? rejection(401, "unauthorized") : { sessionExpiresAt };
}
