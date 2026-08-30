import { expect, test } from "bun:test";

test("controller access keeps the controller token out of browser storage", async () => {
	const source = await Bun.file(new URL("./controller-access.tsx", import.meta.url)).text();
	expect(source).toContain('authRequest("/auth/login", { token })');
	expect(source).toContain("Connect to Gooseberry");
	expect(source).not.toContain("localStorage");
	expect(source).not.toContain("sessionStorage");
	expect(source).not.toContain("/auth/setup");
	expect(source).not.toContain("/auth/password");
});
