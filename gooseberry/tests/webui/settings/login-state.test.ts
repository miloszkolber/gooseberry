import { expect, test } from "bun:test";
import { foldLoginFrame, newLoginState } from "@/settings/login/login-state";

test("login auth and device URLs retain only normalized credential-free HTTP(S) URLs", () => {
	const auth = foldLoginFrame(newLoginState("login", "provider"), {
		kind: "authUrl",
		url: "HTTPS://Example.COM:443/sign-in?code=1",
	});
	expect(auth).toMatchObject({ status: "active", url: "https://example.com/sign-in?code=1" });

	const device = foldLoginFrame(newLoginState("login", "provider"), {
		kind: "deviceCode",
		userCode: "ABCD",
		verificationUri: "http://example.com:80/device",
	});
	expect(device).toMatchObject({
		status: "active",
		deviceCode: { verificationUri: "http://example.com/device" },
	});
});

test("login rejects unsafe, credentialed, controlled, and overlong URLs", () => {
	for (const url of [
		"javascript:alert(1)",
		"data:text/html,login",
		"file:///tmp/login",
		"https://user:password@example.com/login",
		"https://example.com/login\nnext",
		`https://example.com/${"x".repeat(2048)}`,
	]) {
		const state = foldLoginFrame(newLoginState("login", "provider"), { kind: "authUrl", url });
		expect(state.status).toBe("error");
		expect(state.url).toBeUndefined();
		expect(state.error).toContain("invalid sign-in URL");
	}

	const device = foldLoginFrame(newLoginState("login", "provider"), {
		kind: "deviceCode",
		userCode: "ABCD",
		verificationUri: "data:text/plain,nope",
	});
	expect(device.status).toBe("error");
	expect(device.deviceCode).toBeUndefined();
});
