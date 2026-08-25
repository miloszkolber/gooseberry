import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMountedPath, configuredMountRoots } from "./path-admission";

function fixture(): { root: string; project: string; outside: string; state: string } {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-mount-"));
	const project = join(root, "repo");
	const outside = mkdtempSync(join(tmpdir(), "mewa-code-outside-"));
	const state = mkdtempSync(join(tmpdir(), "mewa-code-state-"));
	mkdirSync(project, { recursive: true });
	writeFileSync(join(project, "README.md"), "ok\n");
	return { root, project, outside, state };
}

test("requires an absolute existing mount and rejects root or controller state", () => {
	const value = fixture();
	try {
		const baseEnv = { HOME: value.outside, MEWA_CODE_DATA_DIR: value.state };
		expect(configuredMountRoots({ ...baseEnv, MEWA_MOUNT_ROOTS: value.root })).toEqual([
			value.root,
		]);
		expect(() => configuredMountRoots({ ...baseEnv, MEWA_MOUNT_ROOTS: "/" })).toThrow(
			"must not contain /",
		);
		expect(() => configuredMountRoots({ ...baseEnv, MEWA_MOUNT_ROOTS: value.state })).toThrow(
			"overlaps protected",
		);
		expect(() =>
			configuredMountRoots({ ...baseEnv, MEWA_MOUNT_ROOTS: join(value.root, "missing") }),
		).toThrow("missing or not mounted");
	} finally {
		rmSync(value.root, { recursive: true, force: true });
		rmSync(value.outside, { recursive: true, force: true });
		rmSync(value.state, { recursive: true, force: true });
	}
});

test("canonicalizes approved paths and rejects symlink escapes", () => {
	const value = fixture();
	try {
		const link = join(value.project, "outside");
		symlinkSync(value.outside, link);
		writeFileSync(join(value.outside, "secret.txt"), "secret\n");
		const env = {
			HOME: value.outside,
			MEWA_CODE_DATA_DIR: value.state,
			MEWA_MOUNT_ROOTS: value.root,
		};
		expect(assertMountedPath(join(value.project, "README.md"), { env })).toBe(
			join(value.project, "README.md"),
		);
		expect(() => assertMountedPath(join(link, "secret.txt"), { env })).toThrow(
			"outside the approved",
		);
		expect(() =>
			assertMountedPath(join(value.project, "new", "file.txt"), {
				env,
				allowMissingLeaf: true,
			}),
		).not.toThrow();
		expect(() =>
			assertMountedPath(join(value.project, "README.md", "child"), {
				env,
				allowMissingLeaf: true,
			}),
		).toThrow("parent is not a directory");
	} finally {
		rmSync(value.root, { recursive: true, force: true });
		rmSync(value.outside, { recursive: true, force: true });
		rmSync(value.state, { recursive: true, force: true });
	}
});
