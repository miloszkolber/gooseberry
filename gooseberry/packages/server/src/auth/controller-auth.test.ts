import { expect, test } from "bun:test";
import {
	ControllerAuth,
	DEFAULT_AUTH_MAX_AGE_DAYS,
	SESSION_MAX_AGE_SECONDS,
} from "./controller-auth";

const token = "controller-token-0123456789abcdef0123456789";

test("derives a durable opaque cookie that survives controller restart", () => {
	const first = new ControllerAuth({ token });
	const cookie = first.login(token);
	expect(cookie).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
	expect(cookie).not.toContain(token);
	expect(first.status(cookie)).toEqual({ authenticated: true });

	const restarted = new ControllerAuth({ token });
	expect(restarted.isSession(cookie)).toBe(true);
	expect(restarted.maxAgeSeconds).toBe(SESSION_MAX_AGE_SECONDS);
	expect(DEFAULT_AUTH_MAX_AGE_DAYS).toBe(180);
});

test("rejects the wrong token and invalidates cookies when GOOSEBERRY_TOKEN changes", () => {
	const auth = new ControllerAuth({ token });
	const cookie = auth.login(token) as string;
	expect(auth.login("wrong-token-0123456789abcdef0123456789")).toBeUndefined();
	expect(
		new ControllerAuth({ token: "rotated-token-0123456789abcdef012345678" }).isSession(cookie),
	).toBe(false);
});

test("does not let invalid login attempts block a valid controller token", () => {
	const auth = new ControllerAuth({ token });
	for (let attempt = 0; attempt < 100; attempt += 1) {
		expect(auth.login("wrong-token-0123456789abcdef0123456789")).toBeUndefined();
	}
	expect(auth.login(token)).toMatch(/^[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
});

test("verifies and exposes expiry for the minimum one-day session lifetime", () => {
	let now = 1_000;
	const auth = new ControllerAuth({ token, now: () => now, maxAgeDays: 1 });
	const cookie = auth.login(token) as string;
	expect(auth.isSession(cookie)).toBe(true);
	expect(auth.maxAgeSeconds).toBe(24 * 60 * 60);
	expect(auth.sessionExpiresAt(cookie)).toBe(24 * 60 * 60 * 1000 + 1_000);
	now += 24 * 60 * 60 * 1000 + 1;
	expect(auth.isSession(cookie)).toBe(false);
	expect(auth.sessionExpiresAt(cookie)).toBeUndefined();
});
