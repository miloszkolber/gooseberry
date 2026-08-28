const decoder = new TextDecoder();

export const GIT_TIMEOUT_MS = 10_000;
export const GIT_STDOUT_MAX_BYTES = 1024 * 1024;
export const GIT_STDERR_MAX_BYTES = 64 * 1024;

export interface GitExecOptions {
	env?: Record<string, string | undefined>;
	raw?: boolean;
	timeoutMs?: number;
	maxStdoutBytes?: number;
	maxStderrBytes?: number;
	/** Test-only command seam. Production callers always run the Git executable. */
	command?: string[];
}

export interface GitResult {
	ok: boolean;
	out: string;
	err: string;
	failure?: "timeout" | "output-limit";
}

interface CollectedOutput {
	text: string;
	overflowed: boolean;
}

function boundedOutput(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
	onOverflow: () => void,
): Promise<CollectedOutput> {
	return (async () => {
		const reader = stream.getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		let overflowed = false;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (length + value.byteLength > maxBytes) {
					overflowed = true;
					onOverflow();
					break;
				}
				chunks.push(value);
				length += value.byteLength;
			}
		} catch {
			// Killing an overflowing or timed-out child can interrupt a pending stream read.
		} finally {
			try {
				await reader.cancel();
			} catch {
				// The process has already closed this stream.
			}
			reader.releaseLock();
		}
		const output = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return { text: decoder.decode(output), overflowed };
	})();
}

export async function gitAsync(
	cwd: string,
	args: string[],
	opts: GitExecOptions = {},
): Promise<GitResult> {
	const command = opts.command ?? ["git", "-c", "core.pager=cat", "--no-pager", "-C", cwd, ...args];
	const env = {
		...process.env,
		GIT_OPTIONAL_LOCKS: "0",
		GIT_PAGER: "cat",
		GIT_TERMINAL_PROMPT: "0",
		PAGER: "cat",
		...opts.env,
	};
	const proc = Bun.spawn(command, { env, stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	let stopped = false;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		try {
			proc.kill("SIGKILL");
		} catch {
			// The process may have exited between the limit check and the kill.
		}
	};
	const timer = setTimeout(() => {
		timedOut = true;
		stop();
	}, opts.timeoutMs ?? GIT_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		boundedOutput(proc.stdout, opts.maxStdoutBytes ?? GIT_STDOUT_MAX_BYTES, stop),
		boundedOutput(proc.stderr, opts.maxStderrBytes ?? GIT_STDERR_MAX_BYTES, stop),
		proc.exited,
	]);
	clearTimeout(timer);
	const outputOverflowed = stdout.overflowed || stderr.overflowed;
	const failure = timedOut ? "timeout" : outputOverflowed ? "output-limit" : undefined;
	const err = failure
		? failure === "timeout"
			? "Git command timed out"
			: "Git command exceeded its output limit"
		: stderr.text.trim();
	return {
		ok: exitCode === 0 && !failure,
		out: opts.raw ? stdout.text : stdout.text.trim(),
		err,
		...(failure ? { failure } : {}),
	};
}
