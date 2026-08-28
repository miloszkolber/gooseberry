import { createHash } from "node:crypto";
import {
	closeSync,
	type Dir,
	existsSync,
	fstatSync,
	opendirSync,
	openSync,
	readSync,
	realpathSync,
	statSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
	GitCommit,
	GitDiffFile,
	GitDiffScope,
	GitFileChange,
	GitFileStatus,
	GitHead,
	GitRepository,
	Project,
} from "@gooseberry/contracts";
import { assertMountedDirectory, assertMountedPath } from "../path-admission";
import { getProject } from "../projects";
import { changedFileArgs, type DiffRange, resolveDiffRange } from "./diff-scope";
import { gitAsync } from "./git-exec";

const DISCOVERY_MAX_DEPTH = 5;
export const DISCOVERY_MAX_REPOSITORIES = 64;
const DISCOVERY_MAX_DIRECTORIES = 20_000;
const DISCOVERY_MAX_GIT_PROBES = 256;
/** Global cap on directory entries read while discovering repositories. */
export const DISCOVERY_MAX_SCANNED_ENTRIES = 20_000;
/** Global cap on directories waiting to be scanned. */
export const DISCOVERY_MAX_QUEUED_DIRECTORIES = 4_000;
const REPOSITORY_STATUS_CONCURRENCY = 4;
const UNTRACKED_LINE_COUNT_MAX_FILES = 64;
/** Maximum bytes in a Git file preview, keeping a single WebSocket response bounded. */
export const GIT_PREVIEW_MAX_BYTES = 1024 * 1024;
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

async function isRepository(path: string): Promise<boolean> {
	if (!existsSync(join(path, ".git"))) return false;
	const result = await gitAsync(path, ["rev-parse", "--show-toplevel"]);
	return result.ok && canonicalPath(result.out) === canonicalPath(path);
}

async function repositoryPaths(project: Project): Promise<string[]> {
	const found: string[] = [];
	const seen = new Set<string>();
	let visited = 0;
	let probes = 0;
	let scannedEntries = 0;
	let queuedDirectories = 0;
	for (const configuredRoot of project.roots) {
		const root = assertMountedDirectory(configuredRoot, "Project root");
		if (queuedDirectories >= DISCOVERY_MAX_QUEUED_DIRECTORIES) break;
		const queue: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
		queuedDirectories += 1;
		while (queue.length > 0 && found.length < DISCOVERY_MAX_REPOSITORIES) {
			const current = queue.shift();
			if (
				!current ||
				visited >= DISCOVERY_MAX_DIRECTORIES ||
				scannedEntries >= DISCOVERY_MAX_SCANNED_ENTRIES
			)
				break;
			visited += 1;
			const canonical = canonicalPath(current.path);
			if (seen.has(canonical)) continue;
			seen.add(canonical);
			if (existsSync(join(canonical, ".git"))) {
				if (probes >= DISCOVERY_MAX_GIT_PROBES) break;
				probes += 1;
				if (await isRepository(canonical)) found.push(canonical);
			}
			if (current.depth >= DISCOVERY_MAX_DEPTH) continue;
			let directory: Dir;
			try {
				directory = opendirSync(canonical);
			} catch {
				continue;
			}
			try {
				while (
					scannedEntries < DISCOVERY_MAX_SCANNED_ENTRIES &&
					queuedDirectories < DISCOVERY_MAX_QUEUED_DIRECTORIES
				) {
					const entry = directory.readSync();
					if (entry === null) break;
					scannedEntries += 1;
					if (
						!entry.isDirectory() ||
						entry.isSymbolicLink() ||
						DISCOVERY_IGNORES.has(entry.name) ||
						queuedDirectories >= DISCOVERY_MAX_QUEUED_DIRECTORIES
					)
						continue;
					queue.push({ path: resolve(canonical, entry.name), depth: current.depth + 1 });
					queuedDirectories += 1;
				}
			} catch {
				// A repository can change while it is being discovered. Keep its siblings bounded.
			} finally {
				try {
					directory.closeSync();
				} catch {
					// The handle may already have been closed by the read failure.
				}
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

async function mapLimited<T, R>(
	values: readonly T[],
	limit: number,
	callback: (value: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	const worker = async () => {
		while (next < values.length) {
			const index = next;
			next += 1;
			const value = values[index];
			if (value !== undefined) results[index] = await callback(value);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
	return results;
}

async function repositoryFor(
	projectId: string,
	requested: string,
): Promise<{ project: Project; path: string }> {
	const project = getProject(projectId);
	const wanted = canonicalPath(assertMountedDirectory(requested, "Git repository"));
	const path = (await repositoryPaths(project)).find((candidate) => candidate === wanted);
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

async function numstat(
	repository: string,
	range: DiffRange,
): Promise<Map<string, { added: number; removed: number }>> {
	const counts = new Map<string, { added: number; removed: number }>();
	const out = await gitAsync(repository, changedFileArgs(range, "--numstat"));
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

type PreviewIssue = "binary" | "missing" | "tooLarge" | "unavailable";
type Preview = { content: string } | { issue: PreviewIssue; message: string };

function previewIssue(issue: PreviewIssue): Preview {
	if (issue === "tooLarge") return { issue, message: "File is too large to preview" };
	if (issue === "binary") return { issue, message: "Binary files cannot be previewed" };
	if (issue === "missing") return { issue, message: "File does not exist" };
	return { issue, message: "File is unavailable for preview" };
}

function readWorktreePreview(absolute: string): Preview {
	try {
		const initial = statSync(absolute);
		if (!initial.isFile()) return previewIssue("unavailable");
		if (initial.size > GIT_PREVIEW_MAX_BYTES) return previewIssue("tooLarge");
		const descriptor = openSync(absolute, "r");
		try {
			const opened = fstatSync(descriptor);
			if (!opened.isFile()) return previewIssue("unavailable");
			if (opened.size > GIT_PREVIEW_MAX_BYTES) return previewIssue("tooLarge");
			const content = Buffer.allocUnsafe(opened.size);
			let offset = 0;
			while (offset < content.length) {
				const read = readSync(descriptor, content, offset, content.length - offset, offset);
				if (read === 0) break;
				offset += read;
			}
			if (fstatSync(descriptor).size > GIT_PREVIEW_MAX_BYTES) return previewIssue("tooLarge");
			const preview = content.subarray(0, offset);
			if (preview.includes(0)) return previewIssue("binary");
			return { content: preview.toString("utf8") };
		} finally {
			closeSync(descriptor);
		}
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			return previewIssue("missing");
		}
		return previewIssue("unavailable");
	}
}

function untrackedAdded(repository: string, path: string): number | undefined {
	try {
		const absolute = resolve(repository, path);
		assertMountedPath(absolute, { allowMissingLeaf: true, label: "Git status path" });
		const preview = readWorktreePreview(absolute);
		return "content" in preview ? lineCount(preview.content) : undefined;
	} catch {
		return undefined;
	}
}

async function changes(
	repository: string,
	scope: GitDiffScope = { kind: "uncommitted" },
): Promise<GitFileChange[]> {
	const range = await resolveDiffRange(repository, scope);
	const result: GitFileChange[] = [];
	const [counts, tracked] = await Promise.all([
		numstat(repository, range),
		gitAsync(repository, changedFileArgs(range, "--name-status")),
	]);
	if (!tracked.ok) throw new Error(`Could not read changed files: ${tracked.err || "git failed"}`);
	for (const line of tracked.out.split("\n")) {
		if (!line) continue;
		const parts = line.split("\t");
		const code = parts[0] ?? "";
		const path = parts.length > 2 ? parts.at(-1) : parts[1];
		if (path) result.push({ path, status: mapStatus(code), ...counts.get(path) });
	}
	if (range.untracked) {
		const untracked = await gitAsync(repository, ["ls-files", "--others", "--exclude-standard"]);
		let counted = 0;
		for (const path of untracked.out.split("\n")) {
			if (!path) continue;
			const added =
				counted < UNTRACKED_LINE_COUNT_MAX_FILES ? untrackedAdded(repository, path) : undefined;
			counted += 1;
			result.push({
				path,
				status: "untracked",
				...(added === undefined ? {} : { added, removed: 0 }),
			});
		}
	}
	return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function head(repository: string): Promise<GitHead> {
	const branch = await gitAsync(repository, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
	if (branch.ok && branch.out) return { kind: "branch", name: branch.out };
	const oid = await gitAsync(repository, ["rev-parse", "--verify", "HEAD"]);
	return { kind: "detached", oid: oid.ok ? oid.out : "" };
}

async function projectRepository(project: Project, repository: string): Promise<GitRepository> {
	const [fileChanges, repositoryHead] = await Promise.all([changes(repository), head(repository)]);
	return {
		id: repositoryId(repository),
		root: repository,
		relativePath: projectRelativePath(project, repository),
		name: basename(repository),
		head: repositoryHead,
		clean: fileChanges.length === 0,
		changes: fileChanges,
	};
}

export async function listRepositories(projectId: string): Promise<GitRepository[]> {
	const project = getProject(projectId);
	const repositories = await repositoryPaths(project);
	return mapLimited(repositories, REPOSITORY_STATUS_CONCURRENCY, (repository) =>
		projectRepository(project, repository),
	);
}

export async function gitStatus(projectId: string, repository: string): Promise<GitRepository> {
	const admitted = await repositoryFor(projectId, repository);
	return projectRepository(admitted.project, admitted.path);
}

export async function readBlobAt(
	repository: string,
	ref: string,
	path: string,
): Promise<string | null> {
	const preview = await readBlobPreview(repository, ref, path);
	return "content" in preview ? preview.content : null;
}

async function readBlobPreview(repository: string, ref: string, path: string): Promise<Preview> {
	const object = `${ref}:${path}`;
	const size = await gitAsync(repository, ["cat-file", "-s", "--end-of-options", object]);
	if (!size.ok) return { content: "" };
	const bytes = Number(size.out);
	if (!Number.isSafeInteger(bytes) || bytes < 0) return previewIssue("unavailable");
	if (bytes > GIT_PREVIEW_MAX_BYTES) return previewIssue("tooLarge");
	const shown = await gitAsync(
		repository,
		["show", "--no-ext-diff", "--no-textconv", "--end-of-options", object],
		{ raw: true, maxStdoutBytes: GIT_PREVIEW_MAX_BYTES },
	);
	if (shown.failure === "output-limit") return previewIssue("tooLarge");
	if (!shown.ok) return { content: "" };
	if (shown.out.includes("\0")) return previewIssue("binary");
	return { content: shown.out };
}

function unavailableDiff(issue: Exclude<Preview, { content: string }>): GitDiffFile {
	return {
		original: "",
		modified: "",
		unavailable: true,
		...(issue.issue === "binary" ? { binary: true } : {}),
		...(issue.issue === "tooLarge" ? { tooLarge: true } : {}),
		message: issue.message,
	};
}

export async function gitDiffFile(
	projectId: string,
	repository: string,
	path: string,
	scope?: GitDiffScope,
): Promise<GitDiffFile> {
	const admitted = (await repositoryFor(projectId, repository)).path;
	const range = await resolveDiffRange(admitted, scope);
	const absolute = resolve(admitted, path);
	const rel = relative(admitted, absolute);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path escapes the repository");
	assertMountedPath(absolute, { allowMissingLeaf: true, label: "Git diff path" });
	const original = range.originalRef
		? await readBlobPreview(admitted, range.originalRef, path)
		: { content: "" };
	if (!("content" in original)) return unavailableDiff(original);
	if (range.modifiedRef) {
		const modified = await readBlobPreview(admitted, range.modifiedRef, path);
		return "content" in modified
			? { original: original.content, modified: modified.content }
			: unavailableDiff(modified);
	}
	const modified = readWorktreePreview(absolute);
	return "content" in modified
		? { original: original.content, modified: modified.content }
		: modified.issue === "missing"
			? { original: original.content, modified: "" }
			: unavailableDiff(modified);
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

export async function listCommits(
	projectId: string,
	repository: string,
): Promise<{ commits: GitCommit[] }> {
	const admitted = (await repositoryFor(projectId, repository)).path;
	const log = await gitAsync(admitted, [
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
