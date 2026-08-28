import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMountedPath, configuredMountRoots } from "./path-admission";

function fixture(): { root: string; project: string; outside: string; state: string } {
	const root = mkdtempSync(join(tmpdir(), "gooseberry-mount-"));
	const project = join(root, "repo");
	const outside = mkdtempSync(join(tmpdir(), "gooseberry-outside-"));
	const state = mkdtempSync(join(tmpdir(), "gooseberry-state-"));
	mkdirSync(project, { recursive: true });
	writeFileSync(join(project, "README.md"), "ok\n");
	return { root, project, outside, state };
}

test("requires an absolute existing mount and rejects root or protected descendants", () => {
	const value = fixture();
	try {
		const baseEnv = { HOME: value.outside, GOOSEBERRY_DATA_DIR: value.state };
		expect(configuredMountRoots({ ...baseEnv, GOOSEBERRY_MOUNT_ROOTS: value.root })).toEqual([
			realpathSync(value.root),
		]);
		expect(() => configuredMountRoots({ ...baseEnv, GOOSEBERRY_MOUNT_ROOTS: "/" })).toThrow(
			"must not contain /",
		);
		expect(() => configuredMountRoots({ ...baseEnv, GOOSEBERRY_MOUNT_ROOTS: value.state })).toThrow(
			"overlaps protected",
		);
		expect(() =>
			configuredMountRoots({ ...baseEnv, GOOSEBERRY_MOUNT_ROOTS: join(value.root, "missing") }),
		).toThrow("missing or not mounted");
	} finally {
		rmSync(value.root, { recursive: true, force: true });
		rmSync(value.outside, { recursive: true, force: true });
		rmSync(value.state, { recursive: true, force: true });
	}
});

test("admits broad mounts while denying protected descendant paths and aliases", () => {
	const root = mkdtempSync(join(tmpdir(), "gooseberry-broad-mount-"));
	const state = join(root, ".db", "gooseberry", "gooseberry");
	const project = join(root, "project");
	const alias = join(project, "gooseberry-state");
	const home = mkdtempSync(join(tmpdir(), "gooseberry-broad-mount-home-"));
	try {
		mkdirSync(state, { recursive: true });
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, "README.md"), "ok\n");
		symlinkSync(state, alias);
		const env = {
			HOME: home,
			GOOSEBERRY_MOUNT_ROOTS: root,
			GOOSEBERRY_PROTECTED_STATE_ROOTS: state,
		};
		expect(configuredMountRoots(env)).toEqual([realpathSync(root)]);
		expect(assertMountedPath(root, { env, directory: true, label: "Project" })).toBe(
			realpathSync(root),
		);
		expect(assertMountedPath(join(project, "README.md"), { env })).toBe(
			realpathSync(join(project, "README.md")),
		);
		expect(() => assertMountedPath(state, { env })).toThrow("protected application state");
		expect(() => assertMountedPath(join(state, "auth", "key"), { env })).toThrow(
			"protected application state",
		);
		expect(() => assertMountedPath(alias, { env })).toThrow("protected application state");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("protects home secrets below a broad home mount, including missing leaves and aliases", () => {
	const parent = mkdtempSync(join(tmpdir(), "gooseberry-home-mount-"));
	const home = join(parent, "home", "core");
	const project = join(home, "project");
	const secrets = join(home, ".secrets");
	const alias = join(project, "secrets-link");
	const state = mkdtempSync(join(tmpdir(), "gooseberry-home-mount-state-"));
	try {
		mkdirSync(project, { recursive: true });
		mkdirSync(secrets, { recursive: true });
		writeFileSync(join(project, "README.md"), "ok\n");
		symlinkSync(secrets, alias);
		const env = { HOME: home, GOOSEBERRY_DATA_DIR: state, GOOSEBERRY_MOUNT_ROOTS: home };
		expect(configuredMountRoots(env)).toEqual([realpathSync(home)]);
		expect(assertMountedPath(join(project, "README.md"), { env })).toBe(
			realpathSync(join(project, "README.md")),
		);
		expect(() => assertMountedPath(secrets, { env })).toThrow("protected application state");
		expect(() =>
			assertMountedPath(join(secrets, "new", "credential"), { env, allowMissingLeaf: true }),
		).toThrow("protected application state");
		expect(() =>
			assertMountedPath(join(alias, "new", "credential"), { env, allowMissingLeaf: true }),
		).toThrow("protected application state");
	} finally {
		rmSync(parent, { recursive: true, force: true });
		rmSync(state, { recursive: true, force: true });
	}
});

test("rejects ambiguous, empty, and duplicate mount-root lists", () => {
	const value = fixture();
	try {
		const env = { HOME: value.outside, GOOSEBERRY_DATA_DIR: value.state };
		expect(() =>
			configuredMountRoots({ ...env, GOOSEBERRY_MOUNT_ROOTS: `${value.root},${value.project}:` }),
		).toThrow("must not mix");
		expect(() =>
			configuredMountRoots({ ...env, GOOSEBERRY_MOUNT_ROOTS: `${value.root},` }),
		).toThrow("must not contain empty entries");
		expect(() =>
			configuredMountRoots({ ...env, GOOSEBERRY_MOUNT_ROOTS: `${value.root},${value.root}` }),
		).toThrow("must not contain duplicate entries");
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
			GOOSEBERRY_DATA_DIR: value.state,
			GOOSEBERRY_MOUNT_ROOTS: value.root,
		};
		expect(assertMountedPath(join(value.project, "README.md"), { env })).toBe(
			realpathSync(join(value.project, "README.md")),
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
