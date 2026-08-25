import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { dataDir } from "../persistence";

export interface ProtectedPathOptions {
	cwd?: string;
	roots?: readonly string[];
	home?: string;
	env?: NodeJS.ProcessEnv;
}

function expandHome(value: string, home: string): string {
	const trimmed = value.trim();
	if (trimmed === "~") return home;
	if (trimmed.startsWith("~/")) return join(home, trimmed.slice(2));
	return trimmed;
}

function readConfiguredAgentDir(env: NodeJS.ProcessEnv, home: string): string | undefined {
	const configured = env.PI_CODING_AGENT_DIR?.trim();
	if (configured) return expandHome(configured, home);

	const configHome = expandHome(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), home);
	const configPath = join(configHome, "signet", "pi.json");
	try {
		const value = JSON.parse(readFileSync(configPath, "utf8")) as { agentDir?: unknown };
		return typeof value.agentDir === "string" && value.agentDir.trim()
			? expandHome(value.agentDir, home)
			: undefined;
	} catch {
		return undefined;
	}
}

export function protectedStateRoots(
	options: { env?: NodeJS.ProcessEnv; home?: string; agentDir?: string; mewaDir?: string } = {},
): string[] {
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	const configHome = expandHome(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), home);
	const agentDir =
		options.agentDir ?? readConfiguredAgentDir(env, home) ?? join(home, ".pi", "agent");
	const candidates = [
		agentDir,
		join(home, ".pi"),
		options.mewaDir ?? env.MEWA_CODE_DATA_DIR ?? dataDir(),
		join(configHome, "signet"),
		env.SIGNET_PATH,
	];
	return [
		...new Set(
			candidates.filter((value): value is string => Boolean(value)).map((value) => resolve(value)),
		),
	];
}

function realpathWithMissingLeaf(path: string): string {
	let current = resolve(path);
	const suffix: string[] = [];
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) return resolve(path);
		suffix.unshift(relative(parent, current));
		current = parent;
	}
	try {
		return resolve(realpathSync(current), ...suffix);
	} catch {
		return resolve(path);
	}
}

function isWithin(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isProtectedRoot(candidate: string, options: ProtectedPathOptions = {}): boolean {
	if (!candidate.trim()) return false;
	const home = options.home ?? homedir();
	const cwd = options.cwd ?? process.cwd();
	const expanded = expandHome(candidate, home);
	const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
	const resolvedCandidate = realpathWithMissingLeaf(absolute);
	const roots = options.roots ?? protectedStateRoots({ env: options.env ?? process.env, home });
	return roots.some((root) => realpathWithMissingLeaf(root) === resolvedCandidate);
}

export function isProtectedPath(candidate: string, options: ProtectedPathOptions = {}): boolean {
	if (!candidate.trim()) return false;
	const home = options.home ?? homedir();
	const cwd = options.cwd ?? process.cwd();
	const expanded = expandHome(candidate, home);
	const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
	const resolvedCandidate = realpathWithMissingLeaf(absolute);
	const roots = options.roots ?? protectedStateRoots({ env: options.env ?? process.env, home });
	return roots.some((root) => isWithin(realpathWithMissingLeaf(root), resolvedCandidate));
}

export function assertPathOutsideProtectedState(
	candidate: string,
	options: ProtectedPathOptions = {},
	message = "Protected Pi or Mewa state path",
): void {
	if (isProtectedPath(candidate, options)) throw new Error(`${message}: ${candidate}`);
}

export function shellMentionsProtectedPath(
	command: string,
	options: ProtectedPathOptions = {},
): boolean {
	const env = options.env ?? process.env;
	const home = options.home ?? homedir();
	let expanded = command
		.replace(/\$\{HOME\}|\$HOME/g, home)
		.replace(/(^|[\s"'=(])~(?=\/|$)/g, `$1${home}`);
	for (const name of ["PI_CODING_AGENT_DIR", "MEWA_CODE_DATA_DIR", "SIGNET_PATH"]) {
		const value = env[name]?.trim();
		if (value)
			expanded = expanded.replace(
				new RegExp(`\\$\\{${name}\\}|\\$${name}`, "g"),
				expandHome(value, home),
			);
	}

	const roots = options.roots ?? protectedStateRoots({ env, home });
	if (roots.some((root) => expanded.includes(root))) return true;
	// Inspect every shell word, not only words beginning with `/` or `./`.
	// Subagent commands commonly pass a symlink such as `state-link/key` as a
	// cwd-relative path, and resolving that word is what makes the protection
	// effective against symlink aliases. Non-path words simply resolve outside
	// the protected roots and are harmless.
	const shellWords = [...expanded.matchAll(/(?:^|[\s"'=(<>;&|])([^\s"';&|()<>`]*)/g)].map(
		(match) => match[1] ?? "",
	);
	return shellWords.some((token) => isProtectedPath(token, { ...options, roots, env, home }));
}
