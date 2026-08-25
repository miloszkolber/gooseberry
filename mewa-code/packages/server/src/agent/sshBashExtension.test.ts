import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SshConfig, SshRunner } from "../ssh";
import { sshBashExtension } from "./sshBashExtension";

type RegisteredTool = {
	execute: (...args: readonly unknown[]) => Promise<unknown>;
	name: string;
};

test("routes Pi bash and user-bash through SSH without forwarding controller env", async () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-bash-"));
	try {
		const key = join(root, "id");
		const knownHosts = join(root, "known_hosts");
		writeFileSync(key, "key\n");
		writeFileSync(knownHosts, "host ssh-ed25519 key\n");
		const config: SshConfig = {
			host: "host.example",
			user: "core",
			port: 22,
			privateKeyFile: key,
			knownHostsFile: knownHosts,
			connectTimeoutSeconds: 15,
			keepaliveIntervalSeconds: 15,
			keepaliveCountMax: 3,
		};
		let seenArgs: readonly string[] = [];
		let seenEnv: Record<string, string> | undefined;
		const runner: SshRunner = (args, options) => {
			seenArgs = args;
			seenEnv = options.env;
			return {
				stdout: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode("remote ok\n"));
						controller.close();
					},
				}),
				stderr: null,
				exited: Promise.resolve(0),
				kill() {},
			};
		};
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		let registered: RegisteredTool | undefined;
		const pi = {
			on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
				handlers.set(event, handler);
			},
			registerTool(tool: RegisteredTool) {
				registered = tool;
			},
			getActiveTools: () => ["bash"],
			setActiveTools: () => {},
		} as unknown as ExtensionAPI;
		sshBashExtension(pi, { loadConfig: () => config, runner });
		const ctx = {
			cwd: "/repo/project",
			ui: { setStatus: () => {} },
		};
		await handlers.get("session_start")?.({}, ctx);
		expect(registered?.name).toBe("bash");
		const result = await registered?.execute(
			"tool-1",
			{ command: "printf ok" },
			undefined,
			undefined,
			{
				cwd: "/repo/project",
			},
		);
		expect(result).toMatchObject({ content: [{ text: "remote ok\n" }] });
		expect(seenArgs.join(" ")).toContain("host.example");
		expect(seenArgs.at(-1)).toContain("/repo/project");
		expect(seenEnv).not.toHaveProperty("PROVIDER_TOKEN");
		expect(seenEnv).not.toHaveProperty("MEWA_BROWSER_TOKEN");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
