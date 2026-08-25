import { createHash } from "node:crypto";
import {
	type Dirent,
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
	GitCommit,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	GitHead,
	GitRepository,
	Project,
} from "@mewa-code/contracts";
import { assertMountedDirectory, assertMountedPath } from "../path-admission";
import { getProject } from "../projects";
import { changedFileArgs, type DiffRange, resolveDiffRange } from "./diff-scope";
import { git } from "./git-exec";

const DISCOVERY_MAX_DEPTH = 5;
const DISCOVERY_MAX_REPOSITORIES = 64;
const DISCOVERY_MAX_DIRECTORIES = 20_000;
const DISCOVERY_IGNORES = new Set([
	".git",
	".cache",
	".next",
	".turbo",
	".venv",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"target",
	"vendor",
]);

export function canonicalPath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function isRepository(path: string): boolean {
	if (!existsSync(join(path, ".git"))) return false;
	const result = git(path, ["rev-parse", "--show-toplevel"]);
	return result.ok && canonicalPath(result.out) === canonicalPath(path);
}

function repositoryPaths(project: Project): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	let visited = 0;
	for (const configuredRoot of project.roots) {
		const root = assertMountedDirectory(configuredRoot, "Project root");
		const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
		while (queue.length > 0 && found.length < DISCOVERY_MAX_REPOSITORIES) {
			const current = queue.shift();
			if (!current || visited >= DISCOVERY_MAX_DIRECTORIES) break;
			visited += 1;
			const canonical = canonicalPath(current.path);
			if (seen.has(canonical)) continue;
			seen.add(canonical);
			if (isRepository(canonical)) {
				found.push(canonical);
			}
			if (current.depth >= DISCOVERY_MAX_DEPTH) continue;
			let entries: Dirent<string>[];
			try {
				entries = readdirSync(canonical, { withFileTypes: true, encoding: "utf8" });
			} catch {
				continue;
			}
			for (const entry of entries) {
				if (!entry.isDirectory() || entry.isSymbolicLink() || DISCOVERY_IGNORES.has(entry.name)) {
					continue;
				}
				queue.push({ path: resolve(canonical, entry.name), depth: current.depth + 1 });
			}
		}
	}
	return found.sort((a, b) => a.localeCompare(b));
}

function projectRelativePath(project: Project, repository: string): string {
	for (const root of project.roots) {
		const rel = relative(root, repository);
		if (rel === "") return basename(root);
		if (!rel.startsWith("..") && !isAbsolute(rel)) return `${basename(root)}/${rel}`;
	}
	return basename(repository);
}

function repositoryId(path: string): string {
	return createHash("sha256").update(canonicalPath(path)).digest("hex").slice(0, 24);
}

function repositoryFor(projectId: string, requested: string): { project: Project; path: string } {
	const project = getProject(projectId);
	const wanted = canonicalPath(assertMountedDirectory(requested, "Git repository"));
	const path = repositoryPaths(project).find((candidate) => candidate === wanted);
	if (!path) throw new Error("Directory is not a discovered repository in this project");
	return { project, path };
}

function mapStatus(code: string): GitFileStatus {
	if (code.startsWith("A") || code.startsWith("C")) return "added";
	if (code.startsWith("D")) return "deleted";
	if (code.startsWith("R")) return "renamed";
	return "modified";
}

export function numstatPath(raw: string): string {
	if (!raw.includes("=>")) return raw;
	const brace = raw.match(/^(.*)\{.* => (.*)\}(.*)$/);
	if (brace) return `${brace[1]}${brace[2]}${brace[3]}`.replace(/\/\//g, "/");
	const arrow = raw.match(/ => (.*)$/);
	return arrow ? (arrow[1] ?? raw) : raw;
}

function numstat(
	repository: string,
	range: DiffRange,
): Map<string, { added: number; removed: number }> {
	const counts = new Map<string, { added: number; removed: number }>();
	const out = git(repository, changedFileArgs(range, "--numstat"));
	if (!out.ok) throw new Error(`Could not read changed files: ${out.err || "git failed"}`);
	for (const line of out.out.split("\n")) {
		const parts = line.split("\t");
		if (parts.length < 3) continue;
		const added = Number(parts[0]);
		const removed = Number(parts[1]);
		if (!Number.isFinite(added) || !Number.isFinite(removed)) continue;
		counts.set(numstatPath(parts.slice(2).join("\t")), { added, removed });
	}
	return counts;
}

function lineCount(content: string): number {
	if (content.length === 0) return 0;
	return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

function untrackedAdded(repository: string, path: string): number | undefined {
	try {
		const absolute = resolve(repository, path);
		assertMountedPath(absolute, { allowMissingLeaf: true, label: "Git status path" });
		if (statSync(absolute).size > 2 * 1024 * 1024) return undefined;
		const value = readFileSync(absolute);
		if (value.subarray(0, 8192).includes(0)) return undefined;
		return lineCount(value.toString("utf8"));
	} catch {
		return undefined;
	}
}

function changes(
	repository: string,
	scope: GitDiffScope = { kind: "uncommitted" },
): GitFileChange[] {
	const range = resolveDiffRange(repository, scope);
	const result: GitFileChange[] = [];
	const counts = numstat(repository, range);
	const tracked = git(repository, changedFileArgs(range, "--name-status"));
	if (!tracked.ok) throw new Error(`Could not read changed files: ${tracked.err || "git failed"}`);
	for (const line of tracked.out.split("\n")) {
		if (!line) continue;
		const parts = line.split("\t");
		const code = parts[0] ?? "";
		const path = parts.length > 2 ? parts.at(-1) : parts[1];
		if (path) result.push({ path, status: mapStatus(code), ...counts.get(path) });
	}
	if (range.untracked) {
		const untracked = git(repository, ["ls-files", "--others", "--exclude-standard"]);
		for (const path of untracked.out.split("\n")) {
			if (!path) continue;
			const added = untrackedAdded(repository, path);
			result.push({
				path,
				status: "untracked",
				...(added === undefined ? {} : { added, removed: 0 }),
			});
		}
	}
	return result.sort((a, b) => a.path.localeCompare(b.path));
}

function head(repository: string): GitHead {
	const branch = git(repository, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	if (branch.ok && branch.out) return { kind: "branch", name: branch.out };
	const oid = git(repository, ["rev-parse", "--verify", "HEAD"]);
	return { kind: "detached", oid: oid.ok ? oid.out : "" };
}

function projectRepository(project: Project, repository: string): GitRepository {
	const fileChanges = changes(repository);
	return {
		id: repositoryId(repository),
		root: repository,
		relativePath: projectRelativePath(project, repository),
		name: basename(repository),
		head: head(repository),
		clean: fileChanges.length === 0,
		changes: fileChanges,
	};
}

export function listRepositories(projectId: string): GitRepository[] {
	const project = getProject(projectId);
	return repositoryPaths(project).map((repository) => projectRepository(project, repository));
}

export function gitStatus(projectId: string, repository: string): GitRepository {
	const admitted = repositoryFor(projectId, repository);
	return projectRepository(admitted.project, admitted.path);
}

export function readBlobAt(repository: string, ref: string, path: string): string | null {
	const shown = git(repository, ["show", "--end-of-options", `${ref}:${path}`], { raw: true });
	return shown.ok ? shown.out : null;
}

export function gitDiffFile(
	projectId: string,
	repository: string,
	path: string,
	scope?: GitDiffScope,
): { original: string; modified: string } {
	const admitted = repositoryFor(projectId, repository).path;
	const range = resolveDiffRange(admitted, scope);
	const absolute = resolve(admitted, path);
	const rel = relative(admitted, absolute);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the repository");
	assertMountedPath(absolute, { allowMissingLeaf: true, label: "Git diff path" });
	const original = range.originalRef ? (readBlobAt(admitted, range.originalRef, path) ?? "") : "";
	if (range.modifiedRef)
		return { original, modified: readBlobAt(admitted, range.modifiedRef, path) ?? "" };
	try {
		return { original, modified: readFileSync(absolute, "utf8") };
	} catch {
		return { original, modified: "" };
	}
}

const LOG_SEP = "\u0000";

function plainText(raw: string): string {
	let value = "";
	for (const char of raw) {
		const code = char.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) continue;
		if (code >= 0x80 && code <= 0x9f) continue;
		if (code >= 0x200b && code <= 0x200f) continue;
		if (code >= 0x202a && code <= 0x202e) continue;
		if (code >= 0x2066 && code <= 0x2069) continue;
		if (code === 0x061c || code === 0xfeff || code === 0x00ad) continue;
		value += char;
	}
	return value;
}

export function listCommits(projectId: string, repository: string): { commits: GitCommit[] } {
	const admitted = repositoryFor(projectId, repository).path;
	const log = git(admitted, [
		"log",
		"--max-count=200",
		"--format=%H%x00%h%x00%cI%x00%an%x00%s",
		"--",
	]);
	if (!log.ok || !log.out) return { commits: [] };
	return {
		commits: log.out.split("\n").flatMap((line): GitCommit[] => {
			const [sha, shortSha, committedAt, author, ...subject] = line.split(LOG_SEP);
			if (!sha || !shortSha) return [];
			return [
				{
					sha,
					shortSha,
					committedAt: committedAt ?? "",
					author: plainText(author ?? ""),
					subject: plainText(subject.join(LOG_SEP)),
				},
			];
		}),
	};
}
