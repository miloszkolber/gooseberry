import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FileNode } from "@mewa-code/contracts";
import { assertMountedDirectory, assertMountedPath } from "../pathAdmission";
import { loadWorkspaces } from "../persistence";

function assertContained(root: string, candidate: string, message: string): void {
	const rel = relative(root, candidate);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(message);
}

function resolveInWorktree(workspaceId: string, path: string): { root: string; abs: string } {
	const workspace = loadWorkspaces().find((item) => item.id === workspaceId);
	if (!workspace) throw new Error(`Unknown workspace: ${workspaceId}`);

	const root = assertMountedDirectory(workspace.worktreePath, "Workspace");
	const candidate = resolve(root, path);
	assertContained(root, candidate, "Path escapes the worktree");
	const absolute = assertMountedPath(candidate, { label: "Workspace file" });
	assertContained(root, absolute, "Path escapes the worktree");
	return { root, abs: absolute };
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

export function resolveWorktreeFile(workspaceId: string, path: string): string {
	return resolveInWorktree(workspaceId, path).abs;
}
