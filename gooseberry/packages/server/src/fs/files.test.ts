import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setMountedProjectRootsForTesting } from "../path-admission";
import { saveProjects } from "../persistence";
import { readDir, readFile } from "./files";

let mount: string;

beforeEach(() => {
	mount = mkdtempSync(join(tmpdir(), "gooseberry-files-mount-"));
	setMountedProjectRootsForTesting([mount]);
	mkdirSync(join(mount, "project"));
	writeFileSync(join(mount, "project", "README.md"), "safe\n");
	symlinkSync(join(mount, "project"), join(mount, "project-alias"));
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
	setMountedProjectRootsForTesting(undefined);
	rmSync(mount, { recursive: true, force: true });
});

test("lists files below a project root without following an escaped symlink", () => {
	const entries = readDir("broad-project", mount, "");
	expect(entries).toContainEqual({ path: "project", name: "project", kind: "dir" });
	expect(entries.map((entry) => entry.name)).toContain("project-alias");
});

test("rejects a path that escapes the project root after symlink resolution", () => {
	const outside = mkdtempSync(join(tmpdir(), "gooseberry-files-outside-"));
	try {
		writeFileSync(join(outside, "secret"), "secret\n");
		symlinkSync(outside, join(mount, "escape"));
		expect(() => readFile("broad-project", mount, "escape/secret")).toThrow(
			"Project file is outside a discovered read-only project mount",
		);
	} finally {
		rmSync(outside, { recursive: true, force: true });
	}
});
