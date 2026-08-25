import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { isPortFree } from "@mewa-code/shared/freePort";
import { configurePiRuntime, configurePiRuntimeFactory } from "../agent";
import { type BootedHost, bootHost } from "./boot";

process.setMaxListeners(50);

const booted: BootedHost[] = [];
const tmpDirs: string[] = [];
let testRuntime: ModelRuntime;
const controllerToken = "boot-controller-token-0123456789abcdef012345";
const browserToken = "boot-browser-token-fedcba9876543210fedcba";
const priorControllerToken = process.env.MEWA_CODE_TOKEN;
const priorBrowserToken = process.env.MEWA_BROWSER_TOKEN;

beforeAll(async () => {
	process.env.MEWA_CODE_TOKEN = controllerToken;
	process.env.MEWA_BROWSER_TOKEN = browserToken;
	testRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
});

beforeEach(async () => {
	configurePiRuntime(null);
	configurePiRuntimeFactory(async () => testRuntime);
});

afterEach(async () => {
	while (booted.length) booted.pop()?.server.stop();
	while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
	configurePiRuntimeFactory();
	configurePiRuntime(null);
});

afterAll(() => {
	if (priorControllerToken === undefined) delete process.env.MEWA_CODE_TOKEN;
	else process.env.MEWA_CODE_TOKEN = priorControllerToken;
	if (priorBrowserToken === undefined) delete process.env.MEWA_BROWSER_TOKEN;
	else process.env.MEWA_BROWSER_TOKEN = priorBrowserToken;
});

function grabFreePort(): number {
	const probe = Bun.serve({ port: 0, hostname: "localhost", fetch: () => new Response("x") });
	const port = probe.port;
	if (port == null) throw new Error("probe failed to bind");
	probe.stop(true);
	return port;
}

async function boot(options: Parameters<typeof bootHost>[0]): Promise<BootedHost> {
	const b = await bootHost(options);
	booted.push(b);
	return b;
}

test('portMode "exact" binds the requested port', async () => {
	const requested = grabFreePort();
	const b = await boot({ port: requested, host: "localhost", portMode: "exact" });

	expect(b.requested).toBe(requested);
	expect(b.port).toBe(requested);
	expect(b.server.port).toBe(requested);
	const res = await fetch(`http://localhost:${b.port}/health`);
	expect(res.status).toBe(200);
	expect(await res.text()).toBe("ok");
});

test('portMode "free" scans upward past a taken port', async () => {
	const holder = Bun.serve({ port: 0, hostname: "localhost", fetch: () => new Response("x") });
	const taken = holder.port as number;
	try {
		const b = await boot({ port: taken, host: "localhost", portMode: "free" });
		expect(b.requested).toBe(taken);
		expect(b.port).toBeGreaterThan(taken);
		const res = await fetch(`http://localhost:${b.port}/health`);
		expect(await res.text()).toBe("ok");
	} finally {
		holder.stop(true);
	}
});

test("serves the SPA from staticDir with index.html fallback", async () => {
	const dir = mkdtempSync(join(tmpdir(), "mewa-code-boot-"));
	tmpDirs.push(dir);
	writeFileSync(join(dir, "index.html"), "<!doctype html><title>spa</title>");

	const b = await boot({
		port: grabFreePort(),
		host: "localhost",
		portMode: "exact",
		staticDir: dir,
	});

	const root = await fetch(`http://localhost:${b.port}/`);
	expect(root.status).toBe(200);
	expect(root.headers.get("content-type") ?? "").toContain("text/html");
	expect(await root.text()).toContain("<title>spa</title>");

	const deep = await fetch(`http://localhost:${b.port}/some/client/route`);
	expect(deep.status).toBe(200);
	expect(await deep.text()).toContain("<title>spa</title>");
});

test("does not expose controller file or artifact reads without authentication", async () => {
	const b = await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });

	const file = await fetch(`http://localhost:${b.port}/files/workspace/README.md`);
	const artifact = await fetch(`http://localhost:${b.port}/v1/artifacts/session/screen.png`);

	expect(file.status).toBe(401);
	expect(artifact.status).toBe(401);
});

test("rejects weak controller or browser tokens before binding a listener", async () => {
	const priorController = process.env.MEWA_CODE_TOKEN;
	const priorBrowser = process.env.MEWA_BROWSER_TOKEN;
	try {
		for (const [name, value] of [
			["MEWA_CODE_TOKEN", "short-controller-token"],
			["MEWA_BROWSER_TOKEN", "INVALID_REPLACE_WITH_RANDOM_BROWSER_TOKEN"],
		] as const) {
			process.env.MEWA_CODE_TOKEN = controllerToken;
			process.env.MEWA_BROWSER_TOKEN = browserToken;
			process.env[name] = value;
			const requested = grabFreePort();
			await expect(
				bootHost({ port: requested, host: "localhost", portMode: "free" }),
			).rejects.toThrow(name);
			expect(await isPortFree(requested)).toBe(true);
		}
	} finally {
		if (priorController === undefined) delete process.env.MEWA_CODE_TOKEN;
		else process.env.MEWA_CODE_TOKEN = priorController;
		if (priorBrowser === undefined) delete process.env.MEWA_BROWSER_TOKEN;
		else process.env.MEWA_BROWSER_TOKEN = priorBrowser;
	}
});

test("proxies bounded browser artifacts without exposing the browser token", async () => {
	const seen: { authorization: string | undefined; pathname: string | undefined } = {
		authorization: undefined,
		pathname: undefined,
	};
	const browser = Bun.serve({
		port: 0,
		hostname: "localhost",
		fetch(request) {
			seen.authorization = request.headers.get("authorization") ?? undefined;
			seen.pathname = new URL(request.url).pathname;
			return new Response(new Uint8Array([137, 80, 78, 71]), {
				status: 200,
				headers: { "content-type": "image/png", "content-length": "4" },
			});
		},
	});
	const priorUrl = process.env.MEWA_BROWSER_URL;
	const priorToken = process.env.MEWA_BROWSER_TOKEN;
	const priorCodeToken = process.env.MEWA_CODE_TOKEN;
	process.env.MEWA_BROWSER_URL = `http://localhost:${browser.port}`;
	process.env.MEWA_BROWSER_TOKEN = browserToken;
	process.env.MEWA_CODE_TOKEN = controllerToken;
	try {
		const host = await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });
		const artifact = await fetch(`http://localhost:${host.port}/v1/artifacts/qa/screen.png`, {
			headers: { authorization: `Bearer ${controllerToken}` },
		});
		expect(artifact.status).toBe(200);
		expect(artifact.headers.get("content-type")).toBe("image/png");
		expect(artifact.headers.get("authorization")).toBeNull();
		expect(new Uint8Array(await artifact.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
		expect(seen).toEqual({
			authorization: `Bearer ${browserToken}`,
			pathname: "/v1/artifacts/qa/screen.png",
		});

		const invalid = await fetch(`http://localhost:${host.port}/v1/artifacts/qa/screen.txt`, {
			headers: { authorization: `Bearer ${controllerToken}` },
		});
		expect(invalid.status).toBe(404);
	} finally {
		browser.stop(true);
		if (priorUrl === undefined) delete process.env.MEWA_BROWSER_URL;
		else process.env.MEWA_BROWSER_URL = priorUrl;
		if (priorToken === undefined) delete process.env.MEWA_BROWSER_TOKEN;
		else process.env.MEWA_BROWSER_TOKEN = priorToken;
		if (priorCodeToken === undefined) delete process.env.MEWA_CODE_TOKEN;
		else process.env.MEWA_CODE_TOKEN = priorCodeToken;
	}
});

test("stop() releases the port", async () => {
	const b = await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });
	expect(await isPortFree(b.port)).toBe(false);
	b.server.stop();
	expect(await isPortFree(b.port)).toBe(true);
});
