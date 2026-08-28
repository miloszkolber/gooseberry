import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface PathOptions {
	allowMissingLeaf?: boolean;
	directory?: boolean;
	label?: string;
}

const EXCLUDED_MOUNT_PATHS = [
	"/",
	"/app",
	"/bin",
	"/boot",
	"/dev",
	"/etc",
	"/home/goose",
	"/lib",
	"/lib64",
	"/proc",
	"/root",
	"/run",
	"/sbin",
	"/sys",
	"/tmp",
	"/usr",
	"/var",
	"/var/lib/gooseberry",
	"/home/goose/.config/goose",
] as const;

let testMountRoots: readonly string[] | undefined;
let discoveredMountRoots: readonly string[] | undefined;

function isWithin(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function overlapsExcludedPath(path: string): boolean {
	if (path === "/") return true;
	return EXCLUDED_MOUNT_PATHS.some(
		(excluded) => excluded !== "/" && (isWithin(excluded, path) || isWithin(path, excluded)),
	);
}

function canonicalExisting(path: string): string {
	return resolve(realpathSync(path));
}

function isMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
	);
}

function nearestExistingAncestor(path: string): { path: string; suffix: string[] } | undefined {
	let current = resolve(path);
	const suffix: string[] = [];
	for (;;) {
		try {
			lstatSync(current);
			return { path: current, suffix };
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		suffix.unshift(current.slice(parent.length + 1));
		current = parent;
	}
}

function decodeMountPath(value: string): string | undefined {
	let decoded = "";
	for (let index = 0; index < value.length; index += 1) {
		if (value[index] !== "\\") {
			decoded += value[index];
			continue;
		}
		const octal = value.slice(index + 1, index + 4);
		if (!/^[0-7]{3}$/.test(octal)) return undefined;
		decoded += String.fromCharCode(Number.parseInt(octal, 8));
		index += 3;
	}
	return decoded.includes("\0") ? undefined : decoded;
}

function readOnlyMountPaths(): string[] {
	const paths: string[] = [];
	for (const line of readFileSync("/proc/self/mountinfo", "utf8").split("\n")) {
		if (!line) continue;
		const fields = line.split(" ");
		const mountPath = fields[4];
		const options = fields[5];
		if (!mountPath || !options?.split(",").includes("ro")) continue;
		const decoded = decodeMountPath(mountPath);
		if (decoded) paths.push(decoded);
	}
	return paths;
}

function canonicalProjectMountRoots(paths: readonly string[], excludeSystemPaths = true): string[] {
	const roots = new Set<string>();
	for (const path of paths) {
		if (!isAbsolute(path)) continue;
		const lexical = resolve(path);
		if (excludeSystemPaths && overlapsExcludedPath(lexical)) continue;
		try {
			if (!statSync(lexical).isDirectory()) continue;
			const canonical = canonicalExisting(lexical);
			if (!excludeSystemPaths || !overlapsExcludedPath(canonical)) roots.add(canonical);
		} catch {
			// Mounts can disappear while the controller is reading mountinfo.
		}
	}

	const ordered = [...roots].sort(
		(left, right) => left.length - right.length || left.localeCompare(right),
	);
	return ordered.filter(
		(root, index) => !ordered.slice(0, index).some((parent) => isWithin(parent, root)),
	);
}

/** Lists canonical, read-only project mounts visible to the controller. */
export function mountedProjectRoots(): string[] {
	if (testMountRoots !== undefined) return [...testMountRoots];
	discoveredMountRoots ??= canonicalProjectMountRoots(readOnlyMountPaths());
	return [...discoveredMountRoots];
}

/** Test-only seam for temporary directory fixtures. */
export function setMountedProjectRootsForTesting(roots: readonly string[] | undefined): void {
	testMountRoots = roots === undefined ? undefined : canonicalProjectMountRoots(roots, false);
}

function assertUnderProjectMount(path: string, roots: readonly string[], label: string): void {
	if (!roots.some((root) => isWithin(root, path))) {
		throw new Error(`${label} is outside a discovered read-only project mount: ${path}`);
	}
}

/**
 * Resolve a controller-visible path through a discovered read-only project mount.
 * Existing symlinks are canonicalized, while a missing leaf is accepted only
 * when every existing ancestor remains inside the same mount.
 */
export function resolveVisiblePath(candidate: string, options: PathOptions = {}): string {
	const label = options.label ?? "Path";
	if (!isAbsolute(candidate)) throw new Error(`${label} must be an absolute path: ${candidate}`);
	const absolute = resolve(candidate);
	const roots = mountedProjectRoots();

	try {
		lstatSync(absolute);
		const canonical = canonicalExisting(absolute);
		assertUnderProjectMount(canonical, roots, label);
		if (options.directory && !statSync(canonical).isDirectory()) {
			throw new Error(`${label} is not a directory: ${candidate}`);
		}
		return canonical;
	} catch (error) {
		if (!isMissing(error)) throw error;
		if (!options.allowMissingLeaf) throw new Error(`${label} does not exist: ${absolute}`);
	}

	const ancestor = nearestExistingAncestor(absolute);
	if (!ancestor) throw new Error(`${label} does not exist: ${absolute}`);
	const canonicalAncestor = canonicalExisting(ancestor.path);
	assertUnderProjectMount(canonicalAncestor, roots, label);
	if (ancestor.suffix.length > 0 && !statSync(canonicalAncestor).isDirectory()) {
		throw new Error(`${label} parent is not a directory: ${candidate}`);
	}
	if (
		options.directory &&
		ancestor.suffix.length === 0 &&
		!statSync(canonicalAncestor).isDirectory()
	) {
		throw new Error(`${label} is not a directory: ${candidate}`);
	}
	return resolve(canonicalAncestor, ...ancestor.suffix);
}

export function assertMountedPath(candidate: string, options: PathOptions = {}): string {
	return resolveVisiblePath(candidate, options);
}

export function assertMountedDirectory(candidate: string, label = "Directory"): string {
	return resolveVisiblePath(candidate, { directory: true, label });
}

export function assertMountedProject(candidate: string): string {
	return assertMountedDirectory(candidate, "Project");
}
