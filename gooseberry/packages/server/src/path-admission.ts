import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	configuredPathListEntries,
	isProtectedPath,
	protectedStateRoots,
} from "./agent/protected-paths";

export interface MountPathOptions {
	allowMissingLeaf?: boolean;
	directory?: boolean;
	label?: string;
	env?: NodeJS.ProcessEnv;
}

interface CanonicalRoot {
	display: string;
	path: string;
}

function isWithin(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function canonicalExisting(path: string): string {
	return resolve(realpathSync(path));
}

function nearestExistingAncestor(path: string): { path: string; suffix: string[] } | undefined {
	let current = resolve(path);
	const suffix: string[] = [];
	for (;;) {
		try {
			lstatSync(current);
			return { path: current, suffix };
		} catch {
			// Keep walking until an existing ancestor is found.
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		suffix.unshift(current.slice(parent.length + 1));
		current = parent;
	}
}

function configuredRootEntries(env: NodeJS.ProcessEnv): string[] {
	const raw = env.GOOSEBERRY_MOUNT_ROOTS?.trim();
	if (!raw) {
		throw new Error(
			"GOOSEBERRY_MOUNT_ROOTS is required. Configure one or more absolute same-path bind-mount roots.",
		);
	}
	const entries = configuredPathListEntries(raw, "GOOSEBERRY_MOUNT_ROOTS");
	if (entries.length === 0) {
		throw new Error("GOOSEBERRY_MOUNT_ROOTS must contain at least one absolute directory");
	}
	return entries;
}

function protectedCanonicalRoots(env: NodeJS.ProcessEnv): string[] {
	return protectedStateRoots({ env, home: env.HOME?.trim() || homedir() }).map((root) => {
		try {
			return canonicalExisting(root);
		} catch {
			return resolve(root);
		}
	});
}

export function configuredMountRoots(env: NodeJS.ProcessEnv = process.env): string[] {
	const protectedRoots = protectedCanonicalRoots(env);
	const roots: CanonicalRoot[] = [];
	for (const display of configuredRootEntries(env)) {
		if (!isAbsolute(display)) {
			throw new Error(`GOOSEBERRY_MOUNT_ROOTS entries must be absolute: ${display}`);
		}
		const lexical = resolve(display);
		if (lexical === "/") throw new Error("GOOSEBERRY_MOUNT_ROOTS must not contain /");
		let canonical: string;
		try {
			const stats = lstatSync(lexical);
			if (!stats.isDirectory()) {
				throw new Error(`GOOSEBERRY_MOUNT_ROOTS entry is not a directory: ${display}`);
			}
			canonical = canonicalExisting(lexical);
		} catch (error) {
			if (error instanceof Error && error.message.startsWith("GOOSEBERRY_MOUNT_ROOTS entry")) {
				throw error;
			}
			throw new Error(`GOOSEBERRY_MOUNT_ROOTS entry is missing or not mounted: ${display}`, {
				cause: error,
			});
		}
		if (canonical === "/") throw new Error("GOOSEBERRY_MOUNT_ROOTS must not contain /");
		// A broad same-path mount can contain protected state. Individual path
		// admission still rejects that subtree, including resolved symlink aliases.
		// Only a mount rooted at protected state (or one of its descendants) is unsafe.
		if (protectedRoots.some((root) => isWithin(root, canonical))) {
			throw new Error(
				`GOOSEBERRY_MOUNT_ROOTS entry overlaps protected controller state: ${display}`,
			);
		}
		if (roots.some((root) => root.path === canonical)) {
			throw new Error(`GOOSEBERRY_MOUNT_ROOTS must not contain duplicate entries: ${display}`);
		}
		roots.push({ display, path: canonical });
	}
	for (let index = 0; index < roots.length; index++) {
		for (let other = index + 1; other < roots.length; other++) {
			const first = roots[index];
			const second = roots[other];
			if (
				first &&
				second &&
				(isWithin(first.path, second.path) || isWithin(second.path, first.path))
			) {
				throw new Error("GOOSEBERRY_MOUNT_ROOTS must not mix nested mount roots");
			}
		}
	}
	return roots.sort((a, b) => b.path.length - a.path.length).map((root) => root.path);
}

function missingPathError(path: string, label: string): Error {
	return new Error(`${label} does not exist on an approved same-path mount: ${path}`);
}

function outsidePathError(path: string, label: string): Error {
	return new Error(
		`${label} is outside the approved same-path mounts (GOOSEBERRY_MOUNT_ROOTS): ${path}`,
	);
}

function assertUnderApprovedRoot(path: string, roots: readonly string[], label: string): void {
	if (!roots.some((root) => isWithin(root, path))) throw outsidePathError(path, label);
}

/**
 * Resolve a controller-visible path through an approved same-path mount.
 * Existing symlinks are canonicalized, while a missing leaf is allowed only
 * when every existing ancestor remains inside an approved root.
 */
export function resolveMountedPath(candidate: string, options: MountPathOptions = {}): string {
	const env = options.env ?? process.env;
	const label = options.label ?? "Path";
	const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(process.cwd(), candidate);
	const roots = configuredMountRoots(env);

	if (isProtectedPath(absolute, { env, roots: protectedCanonicalRoots(env) })) {
		throw new Error(`${label} is protected application state: ${absolute}`);
	}

	try {
		lstatSync(absolute);
		const canonical = canonicalExisting(absolute);
		if (isProtectedPath(canonical, { env, roots: protectedCanonicalRoots(env) })) {
			throw new Error(`${label} is protected application state: ${absolute}`);
		}
		assertUnderApprovedRoot(canonical, roots, label);
		if (options.directory && !statSync(canonical).isDirectory()) {
			throw new Error(`${label} is not a directory: ${candidate}`);
		}
		return canonical;
	} catch (error) {
		if (
			error instanceof Error &&
			!["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
		) {
			throw error;
		}
		if (!options.allowMissingLeaf) throw missingPathError(absolute, label);
	}

	const ancestor = nearestExistingAncestor(absolute);
	if (!ancestor) throw missingPathError(absolute, label);
	let canonicalAncestor: string;
	try {
		canonicalAncestor = canonicalExisting(ancestor.path);
	} catch (error) {
		throw new Error(`${label} contains a dangling or unresolved symlink: ${absolute}`, {
			cause: error,
		});
	}
	if (isProtectedPath(canonicalAncestor, { env, roots: protectedCanonicalRoots(env) })) {
		throw new Error(`${label} is protected application state: ${absolute}`);
	}
	assertUnderApprovedRoot(canonicalAncestor, roots, label);
	if (ancestor.suffix.length > 0 && !statSync(canonicalAncestor).isDirectory()) {
		throw new Error(`${label} parent is not a directory: ${candidate}`);
	}
	if (options.directory && ancestor.suffix.length === 0) {
		if (!statSync(canonicalAncestor).isDirectory()) {
			throw new Error(`${label} is not a directory: ${candidate}`);
		}
	}
	return resolve(canonicalAncestor, ...ancestor.suffix);
}

export function assertMountedPath(candidate: string, options: MountPathOptions = {}): string {
	return resolveMountedPath(candidate, options);
}

export function assertMountedDirectory(candidate: string, label = "Directory"): string {
	return resolveMountedPath(candidate, { directory: true, label });
}

export function assertMountedProject(candidate: string): string {
	return assertMountedDirectory(candidate, "Project");
}

export function isApprovedMountedPath(
	candidate: string,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	try {
		resolveMountedPath(candidate, { env });
		return true;
	} catch {
		return false;
	}
}
