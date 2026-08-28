import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { gitAsync } from "./git-exec";

test("kills a controlled command whose stdout exceeds the configured limit", async () => {
	const result = await gitAsync(tmpdir(), [], {
		command: [process.execPath, "-e", 'process.stdout.write("x".repeat(64))'],
		maxStdoutBytes: 8,
	});
	expect(result).toMatchObject({ ok: false, failure: "output-limit" });
	expect(result.out.length).toBeLessThanOrEqual(8);
});

test("kills a controlled command that exceeds the configured timeout", async () => {
	const result = await gitAsync(tmpdir(), [], {
		command: [process.execPath, "-e", "setInterval(() => {}, 1_000)"],
		timeoutMs: 50,
	});
	expect(result).toMatchObject({ ok: false, failure: "timeout" });
});
