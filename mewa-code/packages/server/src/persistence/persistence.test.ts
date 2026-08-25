import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Project, type Workspace } from "@mewa-code/contracts";
import {
	loadConfig,
	loadProjects,
	loadWorkspaces,
	saveConfig,
	saveProjects,
	saveWorkspaces,
} from "./persistence";

let root: string;
const previousDataDir = process.env.MEWA_CODE_DATA_DIR;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "mewa-code-persistence-"));
	process.env.MEWA_CODE_DATA_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
});

const project = (id: string): Project => ({
	id,
	name: id,
	path: `/repos/${id}`,
	slug: id,
	lastOpened: 1,
});

const workspace = (id: string): Workspace => ({
	id,
	projectId: "project",
	name: id,
	branch: "main",
	worktreePath: `/repos/${id}`,
	baseBranch: "main",
});

test("each core JSON store replaces in place and recovers a valid backup", () => {
	const firstProject = [project("first")];
	const secondProject = [project("second")];
	saveProjects(firstProject);
	saveProjects(secondProject);
	writeFileSync(join(root, "projects.json"), "{ malformed");

	expect(loadProjects()).toEqual(firstProject);
	expect(JSON.parse(readFileSync(join(root, "projects.json.bak"), "utf8"))).toEqual(firstProject);

	const firstWorkspace = [workspace("first")];
	const secondWorkspace = [workspace("second")];
	saveWorkspaces(firstWorkspace);
	saveWorkspaces(secondWorkspace);
	writeFileSync(join(root, "workspaces.json"), "[] trailing");
	expect(loadWorkspaces()).toEqual(firstWorkspace);

	saveConfig({ ...DEFAULT_CONFIG, theme: "first" });
	saveConfig({ ...DEFAULT_CONFIG, theme: "second" });
	writeFileSync(join(root, "config.json"), "not json");
	expect(loadConfig().theme).toBe("first");
});

test("a serialization failure leaves the last valid primary and its recovery copy untouched", () => {
	const initial = [project("keep")];
	saveProjects(initial);
	saveProjects([project("new")]);
	const primaryBefore = readFileSync(join(root, "projects.json"), "utf8");
	const backupBefore = readFileSync(join(root, "projects.json.bak"), "utf8");
	const cyclic = project("broken") as Project & { self?: unknown };
	cyclic.self = cyclic;

	expect(() => saveProjects([cyclic])).toThrow();
	expect(readFileSync(join(root, "projects.json"), "utf8")).toBe(primaryBefore);
	expect(readFileSync(join(root, "projects.json.bak"), "utf8")).toBe(backupBefore);
	expect(loadProjects()).toEqual([project("new")]);
});

test("a bounded write rejects oversized state without replacing the prior value", () => {
	const initial = [project("keep")];
	saveProjects(initial);
	const oversized = project("oversized");
	(oversized as Project & { name: string }).name = "x".repeat(16 * 1024 * 1024);

	expect(() => saveProjects([oversized])).toThrow("Persisted JSON exceeds");
	expect(loadProjects()).toEqual(initial);
	expect(existsSync(join(root, ".projects.json"))).toBe(false);
});
