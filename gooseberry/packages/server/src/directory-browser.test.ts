import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	DIRECTORY_BROWSER_MAX_PAGE,
	DIRECTORY_BROWSER_MAX_SCAN,
	DIRECTORY_BROWSER_PAGE_SIZE,
	listDirectories,
} from "./directory-browser";

let mount: string;
let outside: string;
let state: string;
let secrets: string;
const previousMountRoots = process.env.GOOSEBERRY_MOUNT_ROOTS;
const previousDataDir = process.env.GOOSEBERRY_DATA_DIR;
const previousStateRoot = process.env.GOOSEBERRY_STATE_ROOT;
const previousHome = process.env.HOME;

beforeEach(() => {
	mount = mkdtempSync(join(tmpdir(), "gooseberry-directory-browser-mount-"));
	outside = mkdtempSync(join(tmpdir(), "gooseberry-directory-browser-outside-"));
	state = join(mount, "gooseberry-state");
	secrets = join(mount, ".secrets");
	process.env.HOME = mount;
	process.env.GOOSEBERRY_MOUNT_ROOTS = mount;
	process.env.GOOSEBERRY_DATA_DIR = state;
	process.env.GOOSEBERRY_STATE_ROOT = state;
	mkdirSync(join(mount, "alpha"));
	mkdirSync(join(mount, ".hidden"));
	mkdirSync(state);
	mkdirSync(secrets);
	writeFileSync(join(mount, "file.txt"), "not a directory");
	symlinkSync(outside, join(mount, "escape"));
	symlinkSync(state, join(mount, "state-alias"));
	symlinkSync(secrets, join(mount, "secrets-alias"));
});

afterEach(() => {
	rmSync(mount, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
	rmSync(state, { recursive: true, force: true });
	if (previousMountRoots === undefined) delete process.env.GOOSEBERRY_MOUNT_ROOTS;
	else process.env.GOOSEBERRY_MOUNT_ROOTS = previousMountRoots;
	if (previousDataDir === undefined) delete process.env.GOOSEBERRY_DATA_DIR;
	else process.env.GOOSEBERRY_DATA_DIR = previousDataDir;
	if (previousStateRoot === undefined) delete process.env.GOOSEBERRY_STATE_ROOT;
	else process.env.GOOSEBERRY_STATE_ROOT = previousStateRoot;
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
});

test("lists configured roots first and only admitted visible directories below a root", () => {
	const roots = listDirectories();
	expect(roots.path).toBeNull();
	expect(roots.directories).toEqual([{ name: basename(mount), path: mount }]);

	const listing = listDirectories({ path: mount, pageSize: DIRECTORY_BROWSER_PAGE_SIZE });
	expect(listing.path).toBe(mount);
	expect(listing.directories).toContainEqual({ name: "alpha", path: join(mount, "alpha") });
	expect(listing.directories.map((entry) => entry.name)).not.toContain(".hidden");
	expect(listing.directories.map((entry) => entry.name)).not.toContain("file.txt");
	expect(listing.directories.map((entry) => entry.name)).not.toContain("escape");
	expect(listing.directories.map((entry) => entry.name)).not.toContain("gooseberry-state");
	expect(listing.directories.map((entry) => entry.name)).not.toContain("state-alias");
	expect(listing.directories.map((entry) => entry.name)).not.toContain(".secrets");
	expect(listing.directories.map((entry) => entry.name)).not.toContain("secrets-alias");

	const hidden = listDirectories({ path: mount, includeHidden: true });
	expect(hidden.directories).toContainEqual({ name: ".hidden", path: join(mount, ".hidden") });
	expect(() => listDirectories({ path: state })).toThrow("protected application state");
	expect(() => listDirectories({ path: join(mount, "state-alias") })).toThrow(
		"protected application state",
	);
	expect(() => listDirectories({ path: secrets })).toThrow("protected application state");
	expect(() => listDirectories({ path: join(mount, "secrets-alias") })).toThrow(
		"protected application state",
	);
});

test("rejects malformed, non-directory, and escaped directory requests", () => {
	expect(() => listDirectories({ path: `${mount}\0bad` })).toThrow(
		"Invalid directory browser path",
	);
	expect(() => listDirectories({ path: join(mount, "file.txt") })).toThrow("not a directory");
	expect(() => listDirectories({ path: join(mount, "escape") })).toThrow("outside the approved");
	expect(() => listDirectories({ path: mount, page: -1 })).toThrow(
		"Invalid directory browser page",
	);
	expect(() => listDirectories({ path: mount, pageSize: 0 })).toThrow(
		"Invalid directory browser page size",
	);
	expect(() => listDirectories({ path: mount, pageSize: DIRECTORY_BROWSER_PAGE_SIZE + 1 })).toThrow(
		"Invalid directory browser page size",
	);
});

test("does not advertise an unproven page when the traversal bound is reached", () => {
	for (let index = 0; index < DIRECTORY_BROWSER_MAX_SCAN; index += 1) {
		writeFileSync(join(mount, `file-${index}`), "x");
	}
	const listing = listDirectories({ path: mount });
	expect(listing.hasMore).toBeFalse();
});

test("does not advertise a page beyond the configured pagination maximum", () => {
	for (let index = 0; index < DIRECTORY_BROWSER_MAX_PAGE + 2; index += 1) {
		mkdirSync(join(mount, `directory-${index}`));
	}
	const listing = listDirectories({
		path: mount,
		page: DIRECTORY_BROWSER_MAX_PAGE,
		pageSize: 1,
		includeHidden: true,
	});
	expect(listing.directories).toHaveLength(1);
	expect(listing.hasMore).toBeFalse();
});
