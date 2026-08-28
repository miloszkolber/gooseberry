import { createHmac, timingSafeEqual } from "node:crypto";

export const CONTROLLER_AUTH_COOKIE = "gooseberry_auth";
export const DEFAULT_AUTH_MAX_AGE_DAYS = 180;
export const MIN_AUTH_MAX_AGE_DAYS = 1;
export const MAX_AUTH_MAX_AGE_DAYS = 365;
export const SESSION_MAX_AGE_SECONDS = DEFAULT_AUTH_MAX_AGE_DAYS * 24 * 60 * 60;

export interface ControllerAuthStatus {
	readonly authenticated: boolean;
}

export interface ControllerAuthOptions {
	/** The configured controller credential. It is never returned to the browser. */
	token?: string;
	now?: () => number;
	maxAgeDays?: number;
}

function tokenDigest(token: string): Buffer {
	return createHmac("sha256", "gooseberry-controller-token-compare-v1").update(token).digest();
}

function cookieForToken(token: string, expiresAt: number): string {
	const encodedExpiry = expiresAt.toString(36);
	const signature = createHmac("sha256", token)
		.update(`gooseberry-controller-cookie-v1\0${encodedExpiry}`)
		.digest("base64url");
	return `${encodedExpiry}.${signature}`;
}

function constantTimeEqual(left: string, right: string): boolean {
	return timingSafeEqual(tokenDigest(left), tokenDigest(right));
}

/**
 * Stateless controller authentication. The cookie is a deterministic HMAC of GOOSEBERRY_TOKEN, so it
 * survives controller restarts while rotating GOOSEBERRY_TOKEN invalidates every browser immediately.
 */
export class ControllerAuth {
	readonly maxAgeSeconds: number;
	private readonly token: string;
	private readonly now: () => number;

	constructor(options: ControllerAuthOptions = {}) {
		const token = options.token ?? process.env.GOOSEBERRY_TOKEN?.trim();
		if (!token) throw new Error("GOOSEBERRY_TOKEN is required");
		this.token = token;
		this.now = options.now ?? Date.now;
		this.maxAgeSeconds = (options.maxAgeDays ?? DEFAULT_AUTH_MAX_AGE_DAYS) * 24 * 60 * 60;
	}

	status(sessionToken: string | undefined): ControllerAuthStatus {
		return { authenticated: this.isSession(sessionToken) };
	}

	isSession(sessionToken: string | undefined): boolean {
		return this.sessionExpiresAt(sessionToken) !== undefined;
	}

	/** Return the expiry of a verified, still-valid session without exposing the configured token. */
	sessionExpiresAt(sessionToken: string | undefined): number | undefined {
		if (typeof sessionToken !== "string") return undefined;
		const match = /^([0-9a-z]{1,16})\.([A-Za-z0-9_-]{43})$/.exec(sessionToken);
		if (!match) return undefined;
		const encodedExpiry = match[1] as string;
		const expiresAt = Number.parseInt(encodedExpiry, 36);
		if (!Number.isSafeInteger(expiresAt)) return undefined;
		const expected = cookieForToken(this.token, expiresAt);
		if (!constantTimeEqual(expected, sessionToken) || expiresAt * 1000 <= this.now())
			return undefined;
		return expiresAt * 1000;
	}

	login(candidate: string): string | undefined {
		const now = this.now();
		if (typeof candidate === "string" && constantTimeEqual(this.token, candidate)) {
			return cookieForToken(this.token, Math.floor(now / 1000) + this.maxAgeSeconds);
		}
		return undefined;
	}
}

export function sessionCookie(
	token: string,
	secure: boolean,
	maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): string {
	return `${CONTROLLER_AUTH_COOKIE}=${token}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function expiredSessionCookie(secure: boolean): string {
	return `${CONTROLLER_AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}
