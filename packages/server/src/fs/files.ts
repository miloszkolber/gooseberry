import { randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	fsyncSync,
	lstatSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { FileNode } from "@mewa-code/contracts";
import { isProtectedRoot, protectedStateRoots } from "../agent/protectedPaths";
import { loadWorkspaces } from "../persistence";

function assertContained(root: string, candidate: string, message: string): void {
	const rel = relative(root, candidate);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(message);
}

function resolveInWorktree(
	workspaceId: string,
	path: string,
	options: { allowMissingLeaf?: boolean } = {},
): { root: string; abs: string; mode?: number } {
	const ws = loadWorkspaces().find((w) => w.id === workspaceId);
	if (!ws) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = realpathSync(ws.worktreePath);
	if (isProtectedRoot(root, { roots: protectedStateRoots() }))
		throw new Error("Protected Pi or Mewa state cannot be used as a workspace root");
	const abs = resolve(root, path);
	assertContained(root, abs, "Path escapes the worktree");

	if (options.allowMissingLeaf) {
		let mode: number | undefined;
		try {
			const stats = lstatSync(abs);
			if (stats.isSymbolicLink()) throw new Error("Refusing to write through a symlink");
			mode = stats.mode & 0o7777;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const parent = realpathSync(dirname(abs));
		assertContained(root, parent, "Path escapes the worktree");
		return { root, abs, ...(mode === undefined ? {} : { mode }) };
	}

	const real = realpathSync(abs);
	assertContained(root, real, "Path escapes the worktree");
	return { root, abs: real };
}

export function readDir(workspaceId: string, path: string): FileNode[] {
	const { root, abs } = resolveInWorktree(workspaceId, path);

	return readdirSync(abs, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.map(
			(entry): FileNode => ({
				path: relative(root, join(abs, entry.name)),
				name: entry.name,
				kind: entry.isDirectory() ? "dir" : "file",
			}),
		)
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

export function readFile(workspaceId: string, path: string): { content: string } {
	const { abs } = resolveInWorktree(workspaceId, path);
	return { content: readFileSync(abs, "utf8") };
}

export function writeFile(workspaceId: string, path: string, content: string): void {
	const { abs, mode } = resolveInWorktree(workspaceId, path, { allowMissingLeaf: true });
	const temporary = join(dirname(abs), `.${randomUUID()}.mewa-write.tmp`);
	try {
		writeFileSync(temporary, content, { encoding: "utf8", mode: mode ?? 0o666 });
		if (mode !== undefined) chmodSync(temporary, mode);
		const fd = openSync(temporary, "r");
		try {
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temporary, abs);
		const directory = openSync(dirname(abs), "r");
		try {
			fsyncSync(directory);
		} finally {
			closeSync(directory);
		}
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function resolveWorktreeFile(workspaceId: string, path: string): string {
	return resolveInWorktree(workspaceId, path).abs;
}
