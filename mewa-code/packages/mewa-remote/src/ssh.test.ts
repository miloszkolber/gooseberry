import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildSshArgs,
	executeSshCommand,
	remoteBashCommand,
	type SshConfig,
	type SshRunner,
	shellQuote,
} from "./ssh";

let fixture: string | undefined;

function config(): SshConfig {
	fixture = mkdtempSync(join(tmpdir(), "mewa-code-ssh-"));
	const key = join(fixture, "id_ed25519");
	const knownHosts = join(fixture, "known_hosts");
	writeFileSync(key, "test-key\n");
	writeFileSync(knownHosts, "host ssh-ed25519 test\n");
	return {
		host: "host.example",
		user: "core",
		port: 2222,
		privateKeyFile: key,
		knownHostsFile: knownHosts,
		connectTimeoutSeconds: 7,
		keepaliveIntervalSeconds: 11,
		keepaliveCountMax: 2,
	};
}

afterEach(() => {
	if (fixture) rmSync(fixture, { recursive: true, force: true });
	fixture = undefined;
});

test("quotes shell words and builds strict, non-interactive SSH arguments", () => {
	const ssh = config();
	expect(shellQuote("a'b\nvalue")).toBe("'a'\\''b\nvalue'");
	const args = buildSshArgs(ssh, { remoteCommand: remoteBashCommand("printf ok", "/repo/a b") });
	expect(args).toContain("-T");
	expect(args).toContain("BatchMode=yes");
	expect(args).toContain("StrictHostKeyChecking=yes");
	expect(args).toContain(`UserKnownHostsFile=${ssh.knownHostsFile}`);
	expect(args).toContain(`IdentityFile=${ssh.privateKeyFile}`);
	expect(args).toContain("ConnectTimeout=7");
	expect(args).toContain("ServerAliveInterval=11");
	expect(args).toContain("ServerAliveCountMax=2");
	expect(args.at(-2)).toBe("core@host.example");
	expect(args.at(-1)).toContain("bash -lc");
	expect(args.at(-1)).toContain("/repo/a b");
	expect(() => remoteBashCommand("printf\0bad", "/repo")).toThrow("NUL");
});

test("rejects SSH destination values that could be parsed as client options", () => {
	const ssh = config();
	expect(() => buildSshArgs({ ...ssh, host: "-oProxyCommand=sh" })).toThrow("SSH host is invalid");
	expect(() => buildSshArgs({ ...ssh, user: "-oProxyCommand=sh" })).toThrow("SSH user is invalid");
});

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});
}

function fakeRunner(
	stdout: ReadableStream<Uint8Array>,
	stderr: ReadableStream<Uint8Array> = stream(),
): { runner: SshRunner; killed: () => boolean } {
	let killed = false;
	let resolveExit!: (code: number) => void;
	const runner: SshRunner = () => ({
		stdout,
		stderr,
		exited: new Promise<number>((resolve) => {
			resolveExit = resolve;
		}),
		kill() {
			killed = true;
			resolveExit(143);
		},
	});
	return { runner, killed: () => killed };
}

test("bounds remote stdout and cancels the SSH process", async () => {
	const ssh = config();
	const fake = fakeRunner(stream("1234", "5678"));
	await expect(
		executeSshCommand(ssh, "printf output", "/repo", { maxStdoutBytes: 5 }, fake.runner),
	).rejects.toThrow("stdout exceeded");
	expect(fake.killed()).toBe(true);
});

test("aborting a remote command kills the SSH client and preserves the abort result", async () => {
	const ssh = config();
	const fake = fakeRunner(stream());
	const controller = new AbortController();
	const running = executeSshCommand(
		ssh,
		"sleep 30",
		"/repo",
		{ signal: controller.signal },
		fake.runner,
	);
	controller.abort();
	await expect(running).rejects.toThrow("aborted");
	expect(fake.killed()).toBe(true);
});
