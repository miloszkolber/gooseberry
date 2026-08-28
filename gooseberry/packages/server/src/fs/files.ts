import { readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { FileNode } from "@gooseberry/contracts";
import { assertMountedDirectory, assertMountedPath } from "../path-admission";
import { getProject } from "../projects";

function assertContained(root: string, candidate: string, message: string): void {
	const rel = relative(root, candidate);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(message);
}

function resolveInProject(
	projectId: string,
	requestedRoot: string,
	path: string,
): { root: string; abs: string } {
	const project = getProject(projectId);
	const root = assertMountedDirectory(requestedRoot, "Project root");
	if (!project.roots.includes(root)) throw new Error("Unknown project root");
	const candidate = resolve(root, path);
	assertContained(root, candidate, "Path escapes the project root");
	const absolute = assertMountedPath(candidate, { label: "Project file" });
	assertContained(root, absolute, "Path escapes the project root");
	return { root, abs: absolute };
}

export function readDir(projectId: string, root: string, path: string): FileNode[] {
	const resolved = resolveInProject(projectId, root, path);

	return readdirSync(resolved.abs, { withFileTypes: true })
		.filter((entry) => entry.name !== ".git")
		.filter((entry) => {
			try {
				// Resolve every entry before advertising it so symlinks cannot leave the
				// read-only project mount through a later request.
				assertMountedPath(join(resolved.abs, entry.name), { label: "Project file" });
				return true;
			} catch {
				return false;
			}
		})
		.slice(0, 2_000)
		.map(
			(entry): FileNode => ({
				path: relative(resolved.root, join(resolved.abs, entry.name)),
				name: entry.name,
				kind: entry.isDirectory() ? "dir" : "file",
			}),
		)
		.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
}

export function readFile(projectId: string, root: string, path: string): { content: string } {
	const { abs } = resolveInProject(projectId, root, path);
	if (statSync(abs).size > 4 * 1024 * 1024) throw new Error("File is too large to preview");
	return { content: readFileSync(abs, "utf8") };
}

export function resolveProjectFile(projectId: string, root: string, path: string): string {
	return resolveInProject(projectId, root, path).abs;
}
