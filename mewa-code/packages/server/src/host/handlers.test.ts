import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiProfileDescriptor, Workspace } from "@mewa-code/contracts";
import { resetConfigCache } from "../settings";
import { stopAllWatches } from "../watch";
import { handleRequest } from "./handlers";

const context = { clientKey: "test-client" };
let dataDir: string;
let repo: string;
let mountRoot: string;
const previousDataDir = process.env.MEWA_CODE_DATA_DIR;
const previousMountRoots = process.env.MEWA_MOUNT_ROOTS;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "mewa-code-handlers-"));
	mountRoot = mkdtempSync(join(tmpdir(), "mewa-code-handlers-mount-"));
	process.env.MEWA_CODE_DATA_DIR = dataDir;
	resetConfigCache();
	repo = join(mountRoot, "repo");
	process.env.MEWA_MOUNT_ROOTS = repo;
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "test@mewa-code.test");
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
	rmSync(mountRoot, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
	if (previousMountRoots === undefined) delete process.env.MEWA_MOUNT_ROOTS;
	else process.env.MEWA_MOUNT_ROOTS = previousMountRoots;
	resetConfigCache();
});

test("settings.profile exposes the curated state without configuration secrets", async () => {
	const profile = (await handleRequest("settings.profile", {}, context)) as PiProfileDescriptor;
	expect(profile.id).toBe("mewa");
	expect(profile.capabilities.map((capability) => capability.id)).toEqual([
		"browser",
		"webAccess",
		"signetMemory",
		"goals",
		"subagents",
		"protectedStateGuard",
	]);
	expect(JSON.stringify(profile)).not.toContain("SIGNET_DAEMON_URL");
});

test("fs.writeFile stays inside the selected worktree and replaces content safely", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, context)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");

	await expect(
		handleRequest(
			"fs.writeFile",
			{ workspaceId: workspace.id, path: "README.md", content: "# updated\n" },
			context,
		),
	).resolves.toEqual({ ok: true });
	expect(readFileSync(join(repo, "README.md"), "utf8")).toBe("# updated\n");

	const outside = join(dataDir, "outside");
	mkdirSync(outside);
	symlinkSync(outside, join(repo, "link"), "dir");
	await expect(
		handleRequest(
			"fs.writeFile",
			{ workspaceId: workspace.id, path: "../outside/escape.txt", content: "nope" },
			context,
		),
	).rejects.toThrow("Path escapes the worktree");
	await expect(
		handleRequest(
			"fs.writeFile",
			{ workspaceId: workspace.id, path: "link/escape.txt", content: "nope" },
			context,
		),
	).rejects.toThrow("Path escapes the worktree");
});
