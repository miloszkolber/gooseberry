import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isProtectedPath, isProtectedRoot, shellMentionsProtectedPath } from "./protectedPaths";
import { protectedStateGuard } from "./protectedStateGuard";

test("recognizes mounted protected roots through relative paths, symlinks, and shell variables", () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-protected-paths-"));
	const project = join(root, "project");
	const state = join(root, "state");
	mkdirSync(project, { recursive: true });
	mkdirSync(state, { recursive: true });
	writeFileSync(join(state, "credentials.json"), "secret");
	symlinkSync(state, join(project, "state-link"));

	try {
		expect(isProtectedPath("../state/credentials.json", { cwd: project, roots: [state] })).toBe(
			true,
		);
		expect(isProtectedPath("state-link/credentials.json", { cwd: project, roots: [state] })).toBe(
			true,
		);
		expect(isProtectedPath(".", { cwd: project, roots: [state] })).toBe(false);
		expect(isProtectedRoot(state, { roots: [state] })).toBe(true);
		expect(
			shellMentionsProtectedPath("cat $PI_CODING_AGENT_DIR/auth.json", {
				home: join(root, "home"),
				env: { PI_CODING_AGENT_DIR: state },
				roots: [state],
			}),
		).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("blocks file and shell access while allowing bounded subagent tasks and project paths", async () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-protected-guard-"));
	const project = join(root, "project");
	const state = join(root, "state");
	mkdirSync(project, { recursive: true });
	mkdirSync(state, { recursive: true });

	let handler: ((event: ToolCallEvent, context: never) => unknown) | undefined;
	const fakePi = {
		on: (_event: "tool_call", callback: (event: ToolCallEvent, context: never) => unknown) => {
			handler = callback;
		},
	} as unknown as ExtensionAPI;
	protectedStateGuard(project, [state])(fakePi);

	try {
		expect(handler).toBeDefined();
		const call = (toolName: string, input: unknown) =>
			handler?.(
				{ type: "tool_call", toolCallId: toolName, toolName, input: input as never },
				{} as never,
			);
		expect(await call("read", { path: "../state/key" })).toMatchObject({ block: true });
		expect(await call("bash", { command: "cat ../state/key" })).toMatchObject({ block: true });
		expect(await call("subagent", { task: "Inspect the project" })).toBeUndefined();
		expect(await call("read", { path: "README.md" })).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
