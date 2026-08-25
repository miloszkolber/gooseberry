import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@mewa-code/contracts";
import { saveWorkspaces } from "../persistence";
import { writeFile } from "./files";

let root: string;
let worktree: string;
const previousDataDir = process.env.MEWA_CODE_DATA_DIR;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "mewa-code-files-"));
	worktree = join(root, "worktree");
	mkdirSync(worktree, { recursive: true });
	process.env.MEWA_CODE_DATA_DIR = root;
	saveWorkspaces([
		{
			id: "workspace-1",
			projectId: "project-1",
			name: "Workspace",
			branch: "main",
			worktreePath: worktree,
			baseBranch: "main",
		} satisfies Workspace,
	]);
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
});

test("replaces an existing file only after the complete temporary file is ready and keeps its mode", () => {
	const target = join(worktree, "note.txt");
	writeFileSync(target, "before\n");
	chmodSync(target, 0o640);

	writeFile("workspace-1", "note.txt", "after\n");

	expect(readFileSync(target, "utf8")).toBe("after\n");
	expect(statSync(target).mode & 0o777).toBe(0o640);
});

test("a failed replacement preserves existing content and does not create a new file", () => {
	const existing = join(worktree, "existing.txt");
	writeFileSync(existing, "keep me\n");
	const created = join(worktree, "created.txt");
	chmodSync(worktree, 0o555);
	try {
		expect(() => writeFile("workspace-1", "existing.txt", "replace me\n")).toThrow();
		expect(() => writeFile("workspace-1", "created.txt", "new file\n")).toThrow();
	} finally {
		chmodSync(worktree, 0o755);
	}

	expect(readFileSync(existing, "utf8")).toBe("keep me\n");
	expect(() => readFileSync(created, "utf8")).toThrow();
});
