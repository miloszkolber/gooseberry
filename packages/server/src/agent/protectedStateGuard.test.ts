import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isProtectedPath, isProtectedRoot, shellMentionsProtectedPath } from "./protectedPaths";
import { protectedStateGuard } from "./protectedStateGuard";

test("recognizes protected roots through relative paths and symlinks", () => {
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
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("expands shell home and configured path variables before checking access", () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-protected-shell-"));
	const home = join(root, "home");
	const agentDir = join(home, ".pi", "agent");
	mkdirSync(agentDir, { recursive: true });

	try {
		const env = { HOME: home, PI_CODING_AGENT_DIR: agentDir };
		expect(
			shellMentionsProtectedPath('cat "$HOME/.pi/agent/auth.json"', {
				home,
				env,
				roots: [agentDir],
			}),
		).toBe(true);
		expect(
			shellMentionsProtectedPath("cat $PI_CODING_AGENT_DIR/auth.json", {
				home,
				env,
				roots: [agentDir],
			}),
		).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("resolves symlinked protected paths embedded in shell commands", () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-protected-shell-link-"));
	const project = join(root, "project");
	const state = join(root, "state");
	mkdirSync(project, { recursive: true });
	mkdirSync(state, { recursive: true });
	writeFileSync(join(state, "credentials.json"), "secret");
	symlinkSync(state, join(project, "state-link"));

	try {
		expect(
			shellMentionsProtectedPath("cat state-link/credentials.json", {
				cwd: project,
				roots: [state],
			}),
		).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("blocks native and shell tool access while allowing project paths", async () => {
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
		const call = (event: ToolCallEvent) => handler?.(event, {} as never);
		expect(
			await call({
				type: "tool_call",
				toolCallId: "1",
				toolName: "read",
				input: { path: "../state/key" },
			}),
		).toMatchObject({ block: true });
		expect(
			await call({
				type: "tool_call",
				toolCallId: "2",
				toolName: "bash",
				input: { command: "cat ../state/key" },
			}),
		).toMatchObject({ block: true });
		expect(
			await call({
				type: "tool_call",
				toolCallId: "3",
				toolName: "subagent",
				input: { cwd: "../state" },
			}),
		).toMatchObject({ block: true });
		expect(
			await call({
				type: "tool_call",
				toolCallId: "4",
				toolName: "read",
				input: { path: "README.md" },
			}),
		).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("recursively blocks subagent paths, gates, scripts, and sharing surfaces", async () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-protected-nested-"));
	const project = join(root, "project");
	const state = join(root, "state");
	mkdirSync(project, { recursive: true });
	mkdirSync(state, { recursive: true });
	writeFileSync(join(state, "key"), "secret");
	symlinkSync(state, join(project, "state-link"));

	let handler: ((event: ToolCallEvent, context: never) => unknown) | undefined;
	const fakePi = {
		on: (_event: "tool_call", callback: (event: ToolCallEvent, context: never) => unknown) => {
			handler = callback;
		},
	} as unknown as ExtensionAPI;
	protectedStateGuard(project, [state])(fakePi);

	try {
		expect(handler).toBeDefined();
		const call = (input: unknown, toolName = "subagent") =>
			handler?.(
				{
					type: "tool_call",
					toolCallId: "nested",
					toolName,
					input: input as never,
				},
				{} as never,
			);

		expect(
			await call({
				tasks: [{ child: { cwd: "../state" } }, { options: { output: ["state-link/key"] } }],
			}),
		).toMatchObject({ block: true });
		expect(await call({ nested: { gate: "cat ../state/key" } })).toMatchObject({ block: true });
		expect(
			await call({ workflowScript: "return runs.run('worker', { cwd: '../state' })" }),
		).toMatchObject({ block: true });
		expect(await call({ share: true })).toMatchObject({ block: true });
		expect(await call({ upload: { path: "../state/key" } })).toMatchObject({ block: true });
		expect(await call({ mission: false })).toBeUndefined();
		expect(await call({ tasks: [{ cwd: "src", output: ["dist/result.json"] }] })).toBeUndefined();
		expect(await call({ id: "run-123" }, "subagent_wait")).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
