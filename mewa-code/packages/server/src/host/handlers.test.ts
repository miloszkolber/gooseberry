import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetConfigCache } from "../settings";
import { stopAllWatches } from "../watch";
import { handleRequest } from "./handlers";

const context = { clientKey: "test-client" };
let dataDir: string;
let repo: string;
let notes: string;
let nestedRepo: string;
let repositoryWithinRepository: string;
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
	mountRoot = realpathSync(mountRoot);
	process.env.MEWA_CODE_DATA_DIR = dataDir;
	resetConfigCache();
	repo = join(mountRoot, "repo");
	notes = join(mountRoot, "notes");
	nestedRepo = join(notes, "nested-repo");
	repositoryWithinRepository = join(repo, "packages", "independent");
	process.env.MEWA_MOUNT_ROOTS = mountRoot;
	mkdirSync(repo);
	mkdirSync(nestedRepo, { recursive: true });
	repo = realpathSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "test@mewa-code.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	mkdirSync(repositoryWithinRepository, { recursive: true });
	git(repositoryWithinRepository, "init", "-b", "main");
	git(repositoryWithinRepository, "config", "user.email", "test@mewa-code.test");
	git(repositoryWithinRepository, "config", "user.name", "test");
	writeFileSync(join(repositoryWithinRepository, "README.md"), "# independent\n");
	git(repositoryWithinRepository, "add", "-A");
	git(repositoryWithinRepository, "commit", "-m", "init");
	writeFileSync(join(notes, "notes.txt"), "not a repository\n");
	git(nestedRepo, "init", "-b", "main");
	git(nestedRepo, "config", "user.email", "test@mewa-code.test");
	git(nestedRepo, "config", "user.name", "test");
	writeFileSync(join(nestedRepo, "README.md"), "# nested\n");
	git(nestedRepo, "add", "-A");
	git(nestedRepo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "project", roots: [repo, notes], slug: "project", lastOpened: 1 },
		]),
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

test("directory projects expose discovered Git repositories without managing them", async () => {
	const projects = (await handleRequest("project.list", {}, context)) as { roots: string[] }[];
	expect(projects[0]?.roots).toEqual([repo, notes]);
	const repositories = (await handleRequest(
		"git.listRepositories",
		{ projectId: "p1" },
		context,
	)) as { root: string; head: { kind: string; name?: string } }[];
	expect(repositories).toHaveLength(3);
	expect(repositories).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ root: repo, head: { kind: "branch", name: "main" } }),
			expect.objectContaining({ root: nestedRepo, head: { kind: "branch", name: "main" } }),
			expect.objectContaining({
				root: repositoryWithinRepository,
				head: { kind: "branch", name: "main" },
			}),
		]),
	);
});

test("settings expose only model visibility and optional Signet configuration", async () => {
	const config = await handleRequest(
		"settings.update",
		{ config: { signet: { enabled: true, address: "127.0.0.1", port: 3850 } } },
		context,
	);
	expect(config).toMatchObject({ signet: { enabled: true, address: "127.0.0.1", port: 3850 } });
	expect(JSON.stringify(config)).not.toContain("piProfile");
});
