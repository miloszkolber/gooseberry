import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveProjects } from "../persistence";
import { readDir, readFile } from "./files";

let mount: string;
let home: string;
let state: string;
const previousMountRoots = process.env.GOOSEBERRY_MOUNT_ROOTS;
const previousDataDir = process.env.GOOSEBERRY_DATA_DIR;
const previousStateRoot = process.env.GOOSEBERRY_STATE_ROOT;
const previousHome = process.env.HOME;

beforeEach(() => {
	mount = mkdtempSync(join(tmpdir(), "gooseberry-files-mount-"));
	home = mkdtempSync(join(tmpdir(), "gooseberry-files-home-"));
	state = join(mount, "gooseberry-state");
	mkdirSync(join(state, "app"), { recursive: true });
	mkdirSync(join(mount, ".secrets"));
	mkdirSync(join(mount, "project"));
	writeFileSync(join(mount, "project", "README.md"), "safe\n");
	writeFileSync(join(state, "credentials.json"), "secret\n");
	symlinkSync(state, join(mount, "state-alias"));
	symlinkSync(join(mount, ".secrets"), join(mount, "secrets-alias"));
	writeFileSync(join(mount, ".secrets", "credential"), "secret\n");
	process.env.HOME = mount;
	process.env.GOOSEBERRY_MOUNT_ROOTS = mount;
	process.env.GOOSEBERRY_DATA_DIR = join(state, "app");
	process.env.GOOSEBERRY_STATE_ROOT = state;
	saveProjects([
		{
			id: "broad-project",
			name: "broad-project",
			roots: [mount],
			slug: "broad-project",
			lastOpened: Date.now(),
		},
	]);
});

afterEach(() => {
	rmSync(mount, { recursive: true, force: true });
	rmSync(home, { recursive: true, force: true });
	if (previousMountRoots === undefined) delete process.env.GOOSEBERRY_MOUNT_ROOTS;
	else process.env.GOOSEBERRY_MOUNT_ROOTS = previousMountRoots;
	if (previousDataDir === undefined) delete process.env.GOOSEBERRY_DATA_DIR;
	else process.env.GOOSEBERRY_DATA_DIR = previousDataDir;
	if (previousStateRoot === undefined) delete process.env.GOOSEBERRY_STATE_ROOT;
	else process.env.GOOSEBERRY_STATE_ROOT = previousStateRoot;
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
});

test("lists normal broad-root siblings while hiding protected state and aliases", () => {
	const entries = readDir("broad-project", mount, "");
	expect(entries).toContainEqual({ path: "project", name: "project", kind: "dir" });
	expect(entries.map((entry) => entry.name)).not.toContain("gooseberry-state");
	expect(entries.map((entry) => entry.name)).not.toContain("state-alias");
	expect(entries.map((entry) => entry.name)).not.toContain(".secrets");
	expect(entries.map((entry) => entry.name)).not.toContain("secrets-alias");
});

test("denies direct protected file APIs beneath a broad project root", () => {
	expect(() => readDir("broad-project", mount, "gooseberry-state")).toThrow(
		"protected application state",
	);
	expect(() => readDir("broad-project", mount, ".secrets")).toThrow("protected application state");
	expect(() => readFile("broad-project", mount, "state-alias/credentials.json")).toThrow(
		"protected application state",
	);
	expect(() => readFile("broad-project", mount, "secrets-alias/credential")).toThrow(
		"protected application state",
	);
});
