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
import { setMountedProjectRootsForTesting } from "./path-admission";

let mount: string;
let outside: string;

beforeEach(() => {
	mount = mkdtempSync(join(tmpdir(), "gooseberry-directory-browser-mount-"));
	outside = mkdtempSync(join(tmpdir(), "gooseberry-directory-browser-outside-"));
	mkdirSync(join(mount, "alpha"));
	mkdirSync(join(mount, ".hidden"));
	writeFileSync(join(mount, "file.txt"), "not a directory");
	symlinkSync(outside, join(mount, "escape"));
	setMountedProjectRootsForTesting([mount]);
});

afterEach(() => {
	setMountedProjectRootsForTesting(undefined);
	rmSync(mount, { recursive: true, force: true });
	rmSync(outside, { recursive: true, force: true });
});

test("lists discovered project mounts first and directories below a mount", () => {
	const roots = listDirectories();
	expect(roots.path).toBeNull();
	expect(roots.roots).toEqual([mount]);
	expect(roots.directories).toEqual([{ name: basename(mount), path: mount }]);

	const listing = listDirectories({ path: mount, pageSize: DIRECTORY_BROWSER_PAGE_SIZE });
	expect(listing.path).toBe(mount);
	expect(listing.directories).toContainEqual({ name: "alpha", path: join(mount, "alpha") });
	expect(listing.directories.map((entry) => entry.name)).not.toContain(".hidden");
	expect(listing.directories.map((entry) => entry.name)).not.toContain("file.txt");
	expect(listing.directories.map((entry) => entry.name)).not.toContain("escape");

	const hidden = listDirectories({ path: mount, includeHidden: true });
	expect(hidden.directories).toContainEqual({ name: ".hidden", path: join(mount, ".hidden") });
});

test("rejects malformed, unmounted, root, non-directory, and escaped directory requests", () => {
	expect(() => listDirectories({ path: `${mount}\0bad` })).toThrow(
		"Invalid directory browser path",
	);
	expect(() => listDirectories({ path: "/" })).toThrow(
		"outside a discovered read-only project mount",
	);
	expect(() => listDirectories({ path: outside })).toThrow(
		"outside a discovered read-only project mount",
	);
	expect(() => listDirectories({ path: join(mount, "file.txt") })).toThrow("not a directory");
	expect(() => listDirectories({ path: join(mount, "escape") })).toThrow(
		"outside a discovered read-only project mount",
	);
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
