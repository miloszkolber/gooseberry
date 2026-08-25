import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SshConfig } from "../ssh";
import { terminalSshLaunch } from "./terminalManager";

test("terminal launches OpenSSH with a forced remote PTY and exact remote cwd", () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-terminal-"));
	try {
		const key = join(root, "id");
		const knownHosts = join(root, "known_hosts");
		writeFileSync(key, "key\n");
		writeFileSync(knownHosts, "host ssh-ed25519 key\n");
		const config: SshConfig = {
			host: "host.example",
			user: "core",
			port: 2200,
			privateKeyFile: key,
			knownHostsFile: knownHosts,
			connectTimeoutSeconds: 15,
			keepaliveIntervalSeconds: 15,
			keepaliveCountMax: 3,
		};
		const launch = terminalSshLaunch("/repo/project with spaces", config);
		expect(launch.file).toBe("ssh");
		expect(launch.args).toContain("-tt");
		expect(launch.args).toContain("core@host.example");
		expect(launch.args.at(-1)).toContain("bash -lc");
		expect(launch.args.at(-1)).toContain("/repo/project with spaces");
		expect(launch.options.env).toEqual({
			PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
