import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertMountedDirectory,
	assertMountedPath,
	assertMountedProject,
	mountedProjectRoots,
	setMountedProjectRootsForTesting,
} from "./path-admission";

function fixture(): { root: string; project: string; outside: string } {
	const root = mkdtempSync(join(tmpdir(), "gooseberry-path-"));
	const project = join(root, "repo");
	const outside = mkdtempSync(join(tmpdir(), "gooseberry-outside-"));
	mkdirSync(join(project, "nested"), { recursive: true });
	writeFileSync(join(project, "README.md"), "ok\n");
	return { root, project, outside };
}

afterEach(() => {
	setMountedProjectRootsForTesting(undefined);
});

test("admits paths inside canonical injected read-only project mounts", () => {
	const value = fixture();
	try {
		setMountedProjectRootsForTesting([value.project]);
		expect(mountedProjectRoots()).toEqual([realpathSync(value.project)]);
		expect(assertMountedProject(value.project)).toBe(realpathSync(value.project));
		expect(assertMountedDirectory(join(value.project, "nested"))).toBe(
			join(realpathSync(value.project), "nested"),
		);
		expect(assertMountedPath(join(value.project, "README.md"))).toBe(
			join(realpathSync(value.project), "README.md"),
		);
		expect(
			assertMountedPath(join(value.project, "new", "file.txt"), { allowMissingLeaf: true }),
		).toBe(join(realpathSync(value.project), "new", "file.txt"));
	} finally {
		rmSync(value.root, { recursive: true, force: true });
		rmSync(value.outside, { recursive: true, force: true });
	}
});

test("rejects root, state, and unmounted directories", () => {
	const value = fixture();
	try {
		setMountedProjectRootsForTesting([value.project]);
		expect(() => assertMountedProject("/")).toThrow("outside a discovered read-only project mount");
		expect(() => assertMountedProject(value.outside)).toThrow(
			"outside a discovered read-only project mount",
		);
		expect(() => assertMountedProject("/var/lib/gooseberry")).toThrow();
		expect(() => assertMountedPath("relative")).toThrow("must be an absolute path");
	} finally {
		rmSync(value.root, { recursive: true, force: true });
		rmSync(value.outside, { recursive: true, force: true });
	}
});

test("canonicalizes roots and rejects nested duplicate roots and symlink escapes", () => {
	const value = fixture();
	try {
		const nested = join(value.project, "nested");
		const escapeLink = join(value.project, "escape");
		setMountedProjectRootsForTesting([value.project, nested, value.project]);
		expect(mountedProjectRoots()).toEqual([realpathSync(value.project)]);
		symlinkSync(value.outside, escapeLink);
		writeFileSync(join(value.outside, "secret.txt"), "secret\n");
		expect(() => assertMountedPath(join(escapeLink, "secret.txt"))).toThrow(
			"outside a discovered read-only project mount",
		);
		expect(() =>
			assertMountedPath(join(escapeLink, "new", "file.txt"), { allowMissingLeaf: true }),
		).toThrow("outside a discovered read-only project mount");
	} finally {
		rmSync(value.root, { recursive: true, force: true });
		rmSync(value.outside, { recursive: true, force: true });
	}
});
