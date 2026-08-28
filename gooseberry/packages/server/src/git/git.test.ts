import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setMountedProjectRootsForTesting } from "../path-admission";
import { saveProjects, setDataDirForTests } from "../persistence";
import {
	DISCOVERY_MAX_QUEUED_DIRECTORIES,
	DISCOVERY_MAX_REPOSITORIES,
	GIT_PREVIEW_MAX_BYTES,
	gitDiffFile,
	gitStatus,
	listRepositories,
} from "./git";

let dataDir: string;
let mountRoot: string;
let repository: string;

function git(...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", repository, ...args], {
		stdout: "ignore",
		stderr: "ignore",
	});
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

function commitFile(path: string, content: string): void {
	writeFileSync(join(repository, path), content);
	git("add", path);
	git("commit", "-m", `add ${path}`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "gooseberry-git-data-"));
	mountRoot = realpathSync(mkdtempSync(join(tmpdir(), "gooseberry-git-mount-")));
	setMountedProjectRootsForTesting([mountRoot]);
	repository = join(mountRoot, "repository");
	mkdirSync(repository);
	setDataDirForTests(dataDir);
	git("init", "-b", "main");
	git("config", "user.email", "test@gooseberry.test");
	git("config", "user.name", "test");
	saveProjects([
		{
			id: "project",
			name: "project",
			roots: [repository],
			slug: "project",
			lastOpened: 1,
		},
	]);
});

afterEach(() => {
	setMountedProjectRootsForTesting(undefined);
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(mountRoot, { recursive: true, force: true });
	setDataDirForTests(undefined);
});

test("returns ordinary status and diff previews", async () => {
	commitFile("notes.txt", "before\n");
	writeFileSync(join(repository, "notes.txt"), "after\n");

	const status = await gitStatus("project", repository);
	expect(status.changes).toContainEqual(
		expect.objectContaining({ path: "notes.txt", status: "modified" }),
	);
	expect(await gitDiffFile("project", repository, "notes.txt", { kind: "uncommitted" })).toEqual({
		original: "before\n",
		modified: "after\n",
	});
});

test("bounds streamed discovery work and preserves ordinary discovery", async () => {
	commitFile("README.md", "repository\n");
	for (let index = 0; index < DISCOVERY_MAX_QUEUED_DIRECTORIES + 10; index += 1) {
		mkdirSync(join(repository, `decoy-${String(index).padStart(5, "0")}`));
	}
	const lateRepository = join(repository, "zz-late-repository");
	mkdirSync(lateRepository);
	const result = Bun.spawnSync(["git", "-C", lateRepository, "init", "-b", "main"], {
		stdout: "ignore",
		stderr: "ignore",
	});
	expect(result.success).toBe(true);
	writeFileSync(join(lateRepository, "README.md"), "late\n");
	Bun.spawnSync(["git", "-C", lateRepository, "config", "user.email", "test@gooseberry.test"]);
	Bun.spawnSync(["git", "-C", lateRepository, "config", "user.name", "test"]);
	Bun.spawnSync(["git", "-C", lateRepository, "add", "README.md"]);
	Bun.spawnSync(["git", "-C", lateRepository, "commit", "-m", "init"]);

	const repositories = await listRepositories("project");
	expect(repositories.map(({ root }) => root)).toContain(repository);
	expect(repositories.length).toBeLessThanOrEqual(1 + DISCOVERY_MAX_REPOSITORIES);
});

test("refuses an oversized tracked blob before reading it", async () => {
	commitFile("large.txt", "x".repeat(GIT_PREVIEW_MAX_BYTES + 1));

	expect(await gitDiffFile("project", repository, "large.txt", { kind: "uncommitted" })).toEqual({
		original: "",
		modified: "",
		unavailable: true,
		tooLarge: true,
		message: "File is too large to preview",
	});
});

test("refuses an oversized working file before reading it", async () => {
	commitFile("notes.txt", "before\n");
	writeFileSync(join(repository, "notes.txt"), "x".repeat(GIT_PREVIEW_MAX_BYTES + 1));

	expect(await gitDiffFile("project", repository, "notes.txt", { kind: "uncommitted" })).toEqual({
		original: "",
		modified: "",
		unavailable: true,
		tooLarge: true,
		message: "File is too large to preview",
	});
});
