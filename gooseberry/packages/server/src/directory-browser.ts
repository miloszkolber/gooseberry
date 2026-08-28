import { opendirSync } from "node:fs";
import { basename, join } from "node:path";
import type { DirectoryEntry, DirectoryListing } from "@gooseberry/contracts";
import { assertMountedDirectory, mountedProjectRoots } from "./path-admission";

export const DIRECTORY_BROWSER_PAGE_SIZE = 100;
export const DIRECTORY_BROWSER_MAX_PAGE = 99;
export const DIRECTORY_BROWSER_MAX_SCAN = 10_000;

export interface DirectoryBrowserRequest {
	path?: unknown;
	page?: unknown;
	pageSize?: unknown;
	includeHidden?: unknown;
}

function pagination(value: unknown, fallback: number, name: string, max: number): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
		throw new Error(`Invalid directory browser ${name}`);
	}
	return value;
}

function requestPath(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value || value.includes("\0")) {
		throw new Error("Invalid directory browser path");
	}
	return value;
}

function includeHidden(value: unknown): boolean {
	if (value === undefined) return false;
	if (typeof value !== "boolean") throw new Error("Invalid directory browser hidden setting");
	return value;
}

function rootEntry(path: string): DirectoryEntry {
	return { name: basename(path) || path, path };
}

/**
 * Lists selectable directories without ever expanding a path outside the
 * discovered read-only project mounts. Directory scans have a hard entry cap
 * so a filesystem containing many files or unsafe symlinks cannot hold a request.
 */
export function listDirectories(request: DirectoryBrowserRequest = {}): DirectoryListing {
	const page = pagination(request.page, 0, "page", DIRECTORY_BROWSER_MAX_PAGE);
	const pageSize = pagination(
		request.pageSize,
		DIRECTORY_BROWSER_PAGE_SIZE,
		"page size",
		DIRECTORY_BROWSER_PAGE_SIZE,
	);
	if (pageSize === 0) throw new Error("Invalid directory browser page size");
	const hidden = includeHidden(request.includeHidden);
	const path = requestPath(request.path);
	const roots = mountedProjectRoots();

	if (path === undefined) {
		const start = page * pageSize;
		const entries = roots.slice(start, start + pageSize).map(rootEntry);
		return {
			path: null,
			roots,
			directories: entries,
			page,
			pageSize,
			hasMore: page < DIRECTORY_BROWSER_MAX_PAGE && start + entries.length < roots.length,
		};
	}

	const current = assertMountedDirectory(path, "Directory");
	const offset = page * pageSize;
	const directories: DirectoryEntry[] = [];
	let matched = 0;
	let hasMore = false;
	let scanned = 0;
	const directory = opendirSync(current, { bufferSize: DIRECTORY_BROWSER_PAGE_SIZE });
	try {
		for (;;) {
			if (scanned === DIRECTORY_BROWSER_MAX_SCAN) {
				break;
			}
			const entry = directory.readSync();
			if (!entry) break;
			scanned += 1;
			if (!hidden && entry.name.startsWith(".")) continue;

			let candidate: string;
			try {
				// This follows symlinks and confirms the target remains in a project mount.
				candidate = assertMountedDirectory(join(current, entry.name), "Directory");
			} catch {
				continue;
			}
			if (matched < offset) {
				matched += 1;
				continue;
			}
			if (directories.length === pageSize) {
				hasMore = page < DIRECTORY_BROWSER_MAX_PAGE;
				break;
			}
			directories.push({ name: entry.name, path: candidate });
		}
	} finally {
		directory.closeSync();
	}

	return { path: current, roots, directories, page, pageSize, hasMore };
}
