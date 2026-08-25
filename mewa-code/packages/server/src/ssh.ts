import { lstatSync } from "node:fs";
import { isAbsolute } from "node:path";

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 15;
const DEFAULT_KEEPALIVE_INTERVAL_SECONDS = 15;
const DEFAULT_KEEPALIVE_COUNT_MAX = 3;
const DEFAULT_MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 2 * 1024 * 1024;
const SSH_KILL_GRACE_MS = 1_000;

export interface SshConfig {
	host: string;
	user: string;
	port: number;
	privateKeyFile: string;
	knownHostsFile: string;
	connectTimeoutSeconds: number;
	keepaliveIntervalSeconds: number;
	keepaliveCountMax: number;
}

export interface SshConfigValidationOptions {
	checkFiles?: boolean;
}

export interface SshSpawnOptions {
	stdin: "ignore";
	stdout: "pipe";
	stderr: "pipe";
	env: Record<string, string>;
}

export interface SshSpawnProcess {
	readonly stdout: ReadableStream<Uint8Array> | null | undefined;
	readonly stderr: ReadableStream<Uint8Array> | null | undefined;
	readonly exited: Promise<number>;
	kill(signal?: number | NodeJS.Signals): void;
}

export type SshRunner = (args: readonly string[], options: SshSpawnOptions) => SshSpawnProcess;

export interface RemoteCommandOptions {
	signal?: AbortSignal;
	timeoutSeconds?: number;
	maxOutputBytes?: number;
	maxStdoutBytes?: number;
	maxStderrBytes?: number;
	onData?: (data: Buffer) => void;
}

export interface RemoteCommandResult {
	stdout: Buffer;
	stderr: Buffer;
	exitCode: number | null;
}

function positiveInteger(value: string | undefined, name: string, fallback?: number): number {
	if (value === undefined || value.trim() === "") {
		if (fallback !== undefined) return fallback;
		throw new Error(`${name} is required for SSH execution`);
	}
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function optionalPositiveInteger(
	value: string | undefined,
	name: string,
	fallback: number,
): number {
	return positiveInteger(value, name, fallback);
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (!value) throw new Error(`${name} is required for SSH execution`);
	return value;
}

function assertBoundedInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new Error(`${name} must be a positive integer`);
}

export function validateSshConfig(
	config: SshConfig,
	options: SshConfigValidationOptions = {},
): SshConfig {
	if (!config.host || config.host.startsWith("-") || /[\s@]/.test(config.host))
		throw new Error("SSH host is invalid");
	if (!config.user || config.user.startsWith("-") || /[\s@]/.test(config.user))
		throw new Error("SSH user is invalid");
	if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65_535) {
		throw new Error("SSH port must be an integer between 1 and 65535");
	}
	if (!isAbsolute(config.privateKeyFile)) throw new Error("SSH private-key file must be absolute");
	if (!isAbsolute(config.knownHostsFile)) throw new Error("SSH known-hosts file must be absolute");
	assertBoundedInteger(config.connectTimeoutSeconds, "SSH connection timeout");
	assertBoundedInteger(config.keepaliveIntervalSeconds, "SSH keepalive interval");
	assertBoundedInteger(config.keepaliveCountMax, "SSH keepalive count");

	if (options.checkFiles !== false) {
		for (const [label, path] of [
			["SSH private-key file", config.privateKeyFile],
			["SSH known-hosts file", config.knownHostsFile],
		] as const) {
			try {
				if (!lstatSync(path).isFile()) throw new Error("not a regular file");
			} catch (error) {
				throw new Error(`${label} is missing or unreadable: ${path}`, { cause: error });
			}
		}
	}
	return config;
}

export function loadSshConfig(env: NodeJS.ProcessEnv = process.env): SshConfig {
	const privateKeyFile = env.MEWA_SSH_PRIVATE_KEY_FILE?.trim() || env.MEWA_SSH_PRIVATE_KEY?.trim();
	const knownHostsFile =
		env.MEWA_SSH_KNOWN_HOSTS_FILE?.trim() ||
		env.MEWA_SSH_KNOWN_HOSTS?.trim() ||
		env.MEWA_SSH_KNOWN_HOST?.trim();
	const config = {
		host: requiredEnv(env, "MEWA_SSH_HOST"),
		user: requiredEnv(env, "MEWA_SSH_USER"),
		port: positiveInteger(env.MEWA_SSH_PORT, "MEWA_SSH_PORT"),
		privateKeyFile: privateKeyFile || requiredEnv(env, "MEWA_SSH_PRIVATE_KEY_FILE"),
		knownHostsFile: knownHostsFile || requiredEnv(env, "MEWA_SSH_KNOWN_HOSTS_FILE"),
		connectTimeoutSeconds: optionalPositiveInteger(
			env.MEWA_SSH_CONNECT_TIMEOUT_SECONDS,
			"MEWA_SSH_CONNECT_TIMEOUT_SECONDS",
			DEFAULT_CONNECT_TIMEOUT_SECONDS,
		),
		keepaliveIntervalSeconds: optionalPositiveInteger(
			env.MEWA_SSH_KEEPALIVE_INTERVAL_SECONDS,
			"MEWA_SSH_KEEPALIVE_INTERVAL_SECONDS",
			DEFAULT_KEEPALIVE_INTERVAL_SECONDS,
		),
		keepaliveCountMax: optionalPositiveInteger(
			env.MEWA_SSH_KEEPALIVE_COUNT_MAX,
			"MEWA_SSH_KEEPALIVE_COUNT_MAX",
			DEFAULT_KEEPALIVE_COUNT_MAX,
		),
	} satisfies SshConfig;
	return validateSshConfig(config);
}

/** Quote one shell word without interpreting its contents on the remote host. */
export function shellQuote(value: string): string {
	if (value.includes("\0")) throw new Error("SSH command values cannot contain NUL bytes");
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function remoteBashCommand(command: string, cwd: string): string {
	if (command.includes("\0")) throw new Error("SSH command values cannot contain NUL bytes");
	return `bash -lc ${shellQuote(`cd -- ${shellQuote(cwd)} && ${command}`)}`;
}


export function buildSshArgs(
	config: SshConfig,
	options: { remoteCommand?: string; allocatePty?: boolean } = {},
): string[] {
	validateSshConfig(config, { checkFiles: false });
	const args = [
		options.allocatePty ? "-tt" : "-T",
		"-F",
		"/dev/null",
		"-o",
		"BatchMode=yes",
		"-o",
		"StrictHostKeyChecking=yes",
		"-o",
		"PasswordAuthentication=no",
		"-o",
		"KbdInteractiveAuthentication=no",
		"-o",
		"IdentitiesOnly=yes",
		"-o",
		"SendEnv=",
		"-o",
		`UserKnownHostsFile=${config.knownHostsFile}`,
		"-o",
		`IdentityFile=${config.privateKeyFile}`,
		"-o",
		`ConnectTimeout=${config.connectTimeoutSeconds}`,
		"-o",
		`ServerAliveInterval=${config.keepaliveIntervalSeconds}`,
		"-o",
		`ServerAliveCountMax=${config.keepaliveCountMax}`,
		"-p",
		String(config.port),
		`${config.user}@${config.host}`,
	];
	if (options.remoteCommand !== undefined) args.push(options.remoteCommand);
	return args;
}

/** Environment intentionally contains no controller credentials or provider tokens. */
export function sshClientEnvironment(): Record<string, string> {
	return { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" };
}

const defaultRunner: SshRunner = (args, options) =>
	Bun.spawn(["ssh", ...args], options) as unknown as SshSpawnProcess;

function timeoutMs(timeoutSeconds: number | undefined): number | undefined {
	if (timeoutSeconds === undefined) return undefined;
	if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
		throw new Error("SSH command timeout must be a positive number of seconds");
	}
	const milliseconds = timeoutSeconds * 1_000;
	if (!Number.isSafeInteger(Math.ceil(milliseconds)) || milliseconds > 2_147_483_647) {
		throw new Error("SSH command timeout is outside the supported range");
	}
	return milliseconds;
}

function outputLimit(value: number | undefined, fallback: number, name: string): number {
	const result = value ?? fallback;
	assertBoundedInteger(result, name);
	return result;
}

async function drainOutput(
	stream: ReadableStream<Uint8Array> | null | undefined,
	target: Buffer[],
	limit: number,
	onData: ((data: Buffer) => void) | undefined,
	onLimit: () => void,
): Promise<void> {
	if (!stream) return;
	const reader = stream.getReader();
	let size = 0;
	try {
		for (;;) {
			const next = await reader.read();
			if (next.done) return;
			const data = Buffer.from(next.value);
			if (size + data.byteLength > limit) {
				onLimit();
				return;
			}
			size += data.byteLength;
			target.push(data);
			onData?.(data);
		}
	} catch {
		// A killed SSH process can close a stream while its sibling is draining.
		// The process result below determines whether this was cancellation.
		return;
	} finally {
		reader.releaseLock();
	}
}

async function awaitExit(child: SshSpawnProcess, killed: Promise<void>): Promise<number | null> {
	return Promise.race([
		child.exited,
		killed.then(() =>
			Promise.race([
				child.exited,
				new Promise<null>((resolve) => {
					const timer = setTimeout(() => resolve(null), SSH_KILL_GRACE_MS);
					timer.unref?.();
				}),
			]),
		),
	]);
}

export async function executeSshCommand(
	config: SshConfig,
	command: string,
	cwd: string,
	options: RemoteCommandOptions = {},
	runner: SshRunner = defaultRunner,
): Promise<RemoteCommandResult> {
	validateSshConfig(config);
	if (options.signal?.aborted) throw new Error("aborted");
	const commandTimeoutMs = timeoutMs(options.timeoutSeconds);
	const stdoutLimit = outputLimit(
		options.maxStdoutBytes ?? options.maxOutputBytes,
		DEFAULT_MAX_STDOUT_BYTES,
		"SSH stdout limit",
	);
	const stderrLimit = outputLimit(
		options.maxStderrBytes ?? options.maxOutputBytes,
		DEFAULT_MAX_STDERR_BYTES,
		"SSH stderr limit",
	);
	const args = buildSshArgs(config, { remoteCommand: remoteBashCommand(command, cwd) });
	let child: SshSpawnProcess;
	try {
		child = runner(args, {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: sshClientEnvironment(),
		});
	} catch (error) {
		throw new Error("Could not start the SSH client", { cause: error });
	}

	let aborted = false;
	let timedOut = false;
	let killed = false;
	let outputError: Error | undefined;
	let resolveKilled!: () => void;
	const killedPromise = new Promise<void>((resolve) => {
		resolveKilled = resolve;
	});
	const kill = (): void => {
		if (killed) return;
		killed = true;
		resolveKilled();
		try {
			child.kill("SIGTERM");
		} catch {
			// The process may have exited between the limit/cancellation check and kill.
		}
	};
	const onAbort = (): void => {
		aborted = true;
		kill();
	};
	options.signal?.addEventListener("abort", onAbort, { once: true });
	if (options.signal?.aborted) onAbort();
	const timer =
		commandTimeoutMs === undefined
			? undefined
			: setTimeout(() => {
					timedOut = true;
					kill();
				}, commandTimeoutMs);
	timer?.unref?.();

	const stdout: Buffer[] = [];
	const stderr: Buffer[] = [];
	const stdoutTask = drainOutput(child.stdout, stdout, stdoutLimit, options.onData, () => {
		outputError ??= new Error(`SSH stdout exceeded the ${stdoutLimit}-byte limit`);
		kill();
	});
	const stderrTask = drainOutput(child.stderr, stderr, stderrLimit, options.onData, () => {
		outputError ??= new Error(`SSH stderr exceeded the ${stderrLimit}-byte limit`);
		kill();
	});
	try {
		const exitCode = await awaitExit(child, killedPromise);
		await Promise.race([
			Promise.allSettled([stdoutTask, stderrTask]),
			killedPromise.then(
				() =>
					new Promise<void>((resolve) => {
						const grace = setTimeout(resolve, SSH_KILL_GRACE_MS);
						grace.unref?.();
					}),
			),
		]);
		if (aborted || options.signal?.aborted) throw new Error("aborted");
		if (timedOut) throw new Error(`timeout:${String(options.timeoutSeconds)}`);
		if (outputError) throw outputError;
		return { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode };
	} finally {
		if (timer) clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

export function sshCommandOutputLimits(): { stdout: number; stderr: number } {
	return { stdout: DEFAULT_MAX_STDOUT_BYTES, stderr: DEFAULT_MAX_STDERR_BYTES };
}
