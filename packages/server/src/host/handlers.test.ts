import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PiProfileDescriptor,
	Workspace,
	WorkspaceWatchReadyResult,
} from "@mewa-code/contracts";
import { resetConfigCache } from "../settings";
import { stopAllWatches } from "../watch";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "test-client" };

let dataDir: string;
let repo: string;
const savedDataDir = process.env.MEWA_CODE_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-handlers-test-"));
	process.env.MEWA_CODE_DATA_DIR = dataDir;
	resetConfigCache();
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@mewa-code.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	stopAllWatches();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = savedDataDir;
	resetConfigCache();
});

test("workspace.watchReady waits for startup once, then reports an already-ready watcher", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");

	const first = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(first).toEqual({ startupNudge: true });
	const second = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(second).toEqual({ startupNudge: false });
});

test("workspace.remove rejects the Default at the handler level, before any teardown side-effect", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const def = rows[0];
	if (def?.kind !== "default")
		throw new Error("expected the ensured Default workspace pinned first");

	await expect(handleRequest("workspace.remove", { id: def.id }, CTX)).rejects.toThrow(
		"The Default workspace cannot be removed",
	);

	const after = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	expect(after.filter((w) => w.kind === "default")).toHaveLength(1);
	expect(after[0]?.id).toBe(def.id);
});

test("session goal handlers require a known workspace session pair", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");

	await expect(
		handleRequest(
			"session.goalGet",
			{ workspaceId: workspace.id, sessionId: "not-a-session" },
			CTX,
		),
	).rejects.toThrow("Unknown session");
	await expect(
		handleRequest(
			"session.goalGet",
			{ workspaceId: "not-a-workspace", sessionId: "not-a-session" },
			CTX,
		),
	).rejects.toThrow("Unknown workspace");
});

test("settings.profile exposes the curated state without exposing configuration secrets", async () => {
	const initial = (await handleRequest("settings.profile", {}, CTX)) as PiProfileDescriptor;
	expect(initial.id).toBe("mewa");
	expect(initial.capabilities.map((capability) => capability.id)).toEqual([
		"browser",
		"webAccess",
		"signetMemory",
		"goals",
		"subagents",
		"protectedStateGuard",
	]);
	const signet = initial.capabilities.find((capability) => capability.id === "signetMemory");
	expect(signet).toMatchObject({ available: false, enabled: false });
	expect(JSON.stringify(initial)).not.toContain("SIGNET_DAEMON_URL");

	await handleRequest("settings.update", { config: { piProfile: { browser: false } } }, CTX);
	const updated = (await handleRequest("settings.profile", {}, CTX)) as PiProfileDescriptor;
	expect(updated.capabilities.find((capability) => capability.id === "browser")).toMatchObject({
		available: true,
		enabled: false,
	});
	expect(
		updated.capabilities.find((capability) => capability.id === "protectedStateGuard"),
	).toMatchObject({
		available: true,
		enabled: true,
		required: true,
	});
});

test("fs.writeFile saves a file through the retained host boundary", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");

	await expect(
		handleRequest(
			"fs.writeFile",
			{ workspaceId: workspace.id, path: "README.md", content: "# updated\n" },
			CTX,
		),
	).resolves.toEqual({ ok: true });
	expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# updated\n");
});

test("fs.writeFile rejects escaping and symlink paths", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");
	const outside = join(dataDir, "outside");
	mkdirSync(outside);
	symlinkSync(outside, join(repo, "link"), "dir");

	await expect(
		handleRequest(
			"fs.writeFile",
			{ workspaceId: workspace.id, path: "../outside/escape.txt", content: "nope" },
			CTX,
		),
	).rejects.toThrow("Path escapes the worktree");
	await expect(
		handleRequest(
			"fs.writeFile",
			{ workspaceId: workspace.id, path: "link/escape.txt", content: "nope" },
			CTX,
		),
	).rejects.toThrow("Path escapes the worktree");
});
