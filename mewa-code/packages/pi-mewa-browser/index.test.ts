import { describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	BROWSER_MAX_ARGS,
	buildBrowserRequest,
	createBrowserTool,
	executeBrowserRequest,
	mewaBrowser,
	readJsonBounded,
} from "./index";

const browserToken = "browser-extension-token-0123456789abcdef012345";

function withEnvironment(values: Record<string, string | undefined>, task: () => Promise<void>) {
	const prior = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	for (const [key, value] of Object.entries(values)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	return task().finally(() => {
		for (const [key, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
}

describe("browser extension", () => {
	it("registers only the browser tool with bounded argument schema", () => {
		const tools: Array<{ name: string; parameters: { properties?: Record<string, unknown> } }> = [];
		mewaBrowser({
			registerTool(tool: { name: string; parameters: { properties?: Record<string, unknown> } }) {
				tools.push(tool);
			},
		} as unknown as ExtensionAPI);

		expect(tools.map((tool) => tool.name)).toEqual(["browser"]);
		expect(tools[0]?.parameters.properties?.args).toMatchObject({ maxItems: BROWSER_MAX_ARGS });
	});

	it("derives stable per-Pi-session identities and preserves bounded command arguments", () => {
		const one = buildBrowserRequest({ command: "snapshot" }, "/workspace/project", "pi-session-a");
		const two = buildBrowserRequest({ command: "snapshot" }, "/workspace/project", "pi-session-a");
		expect(one).toEqual(two);
		expect(one.session).toMatch(/^p[A-Fa-f0-9]{20}$/);
		expect(one.args).toEqual([]);
		const otherSession = buildBrowserRequest(
			{ command: "snapshot" },
			"/workspace/project",
			"pi-session-b",
		);
		expect(otherSession.session).not.toBe(one.session);

		const explicit = buildBrowserRequest(
			{ command: "click", session: "qa", args: ["@e1"] },
			"/workspace/project",
		);
		expect(explicit).toEqual({ session: "qa", command: "click", args: ["@e1"] });
	});

	it("sends the independent token and turns an artifact into an image block", async () => {
		const calls: Array<{ input: RequestInfo | URL; init?: RequestInit | undefined }> = [];
		const fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (
			input,
			init,
		) => {
			calls.push({ input, init });
			if (String(input).endsWith("/v1/browser")) {
				return new Response(
					JSON.stringify({
						code: 0,
						stdout: "captured",
						artifact: {
							name: "screen.png",
							url: "http://browser.test:8787/v1/artifacts/qa/screen.png",
						},
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}
			return new Response(new Uint8Array([137, 80, 78, 71]), {
				status: 200,
				headers: { "content-type": "image/png", "content-length": "4" },
			});
		};

		await withEnvironment(
			{ MEWA_BROWSER_URL: "http://browser.test:8787/", MEWA_BROWSER_TOKEN: browserToken },
			async () => {
				const result = await executeBrowserRequest(
					{ command: "screenshot", session: "qa", args: ["screen.png"] },
					"/workspace/project",
					undefined,
					fetchImpl,
				);
				expect(result.details).toEqual({
					session: "qa",
					command: "screenshot",
					code: 0,
					artifact: { name: "screen.png", url: "/v1/artifacts/qa/screen.png" },
				});
				expect(result.content).toEqual([
					{ type: "text", text: "captured" },
					{ type: "image", data: "iVBORw==", mimeType: "image/png" },
				]);
			},
		);

		expect(calls).toHaveLength(2);
		expect(calls[0]?.init?.headers).toEqual({
			authorization: `Bearer ${browserToken}`,
			"content-type": "application/json",
		});
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			session: "qa",
			command: "screenshot",
			args: ["screen.png"],
		});
		expect(calls[1]?.init?.headers).toEqual({ authorization: `Bearer ${browserToken}` });
	});

	it("fails closed when the browser token is missing", async () => {
		await withEnvironment({ MEWA_BROWSER_TOKEN: undefined }, async () => {
			await expect(
				executeBrowserRequest(
					{ command: "snapshot" },
					"/workspace/project",
					undefined,
					async () => {
						throw new Error("fetch should not be called");
					},
				),
			).rejects.toThrow("MEWA_BROWSER_TOKEN is not configured");
		});
	});

	it("rejects a short or documented browser token before fetch", async () => {
		for (const token of ["too-short", "INVALID_REPLACE_WITH_RANDOM_BROWSER_TOKEN"]) {
			await withEnvironment({ MEWA_BROWSER_TOKEN: token }, async () => {
				await expect(
					executeBrowserRequest(
						{ command: "snapshot" },
						"/workspace/project",
						undefined,
						async () => {
							throw new Error("fetch should not be called");
						},
					),
				).rejects.toThrow("MEWA_BROWSER_TOKEN must be at least 32");
			});
		}
	});

	it("fails closed when a service response points outside its artifact route", async () => {
		await withEnvironment(
			{ MEWA_BROWSER_URL: "http://browser.test:8787", MEWA_BROWSER_TOKEN: browserToken },
			async () => {
				await expect(
					executeBrowserRequest(
						{ command: "screenshot", session: "qa", args: ["screen.png"] },
						"/workspace/project",
						undefined,
						async () =>
							new Response(JSON.stringify({ artifact: { name: "screen.png", url: "/health" } }), {
								status: 200,
								headers: { "content-type": "application/json" },
							}),
					),
				).rejects.toThrow("unexpected origin or path");
			},
		);
	});

	it("rejects an oversized service response before parsing it", async () => {
		const response = new Response("0123456789", {
			status: 200,
			headers: { "content-length": "10" },
		});
		await expect(readJsonBounded(response, 9)).rejects.toThrow("exceeded its maximum size");
	});

	it("uses the same request path through the registered tool definition", async () => {
		const calls: RequestInit[] = [];
		const fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (
			_input,
			init,
		) => {
			if (init) calls.push(init);
			return new Response(JSON.stringify({ stdout: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		await withEnvironment(
			{ MEWA_BROWSER_URL: "http://browser.test:8787", MEWA_BROWSER_TOKEN: browserToken },
			async () => {
				const tool = createBrowserTool(fetchImpl);
				await tool.execute("call-1", { command: "read", args: [] }, undefined, undefined, {
					cwd: "/workspace/project",
					sessionManager: { getSessionId: () => "pi-session-a" },
				} as never);
			},
		);
		expect(calls).toHaveLength(1);
	});

	it("keeps two Pi sessions in one cwd on separate browser profiles", async () => {
		const bodies: string[] = [];
		const fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (
			_input,
			init,
		) => {
			if (init?.body) bodies.push(String(init.body));
			return new Response(JSON.stringify({ stdout: "ok" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};

		await withEnvironment(
			{ MEWA_BROWSER_URL: "http://browser.test:8787", MEWA_BROWSER_TOKEN: browserToken },
			async () => {
				const tool = createBrowserTool(fetchImpl);
				const context = (sessionId: string) =>
					({
						cwd: "/workspace/project",
						sessionManager: { getSessionId: () => sessionId },
					}) as never;
				await tool.execute(
					"call-a",
					{ command: "snapshot" },
					undefined,
					undefined,
					context("pi-a"),
				);
				await tool.execute(
					"call-b",
					{ command: "snapshot" },
					undefined,
					undefined,
					context("pi-b"),
				);
			},
		);

		expect(bodies).toHaveLength(2);
		expect(JSON.parse(bodies[0] as string).session).not.toBe(
			JSON.parse(bodies[1] as string).session,
		);
	});
});
