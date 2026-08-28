import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

function within(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function configuredPathListEntries(value: string, label: string): string[] {
	const separator = value.includes(",") ? "," : "\n";
	const raw = value.split(separator).map((entry, index, entries) => {
		const trimmed = entry.trim();
		return separator === "," && index === entries.length - 1 && trimmed.endsWith(":")
			? trimmed.slice(0, -1)
			: trimmed;
	});
	if (raw.some((entry) => !entry)) throw new Error(`${label} must not contain empty entries`);
	const entries = raw;
	if (entries.some((entry) => !isAbsolute(entry)))
		throw new Error(`${label} entries must be absolute`);
	return entries;
}

export function protectedStateRoots(input: { env: NodeJS.ProcessEnv; home?: string }): string[] {
	const home = input.home ?? homedir();
	const explicit = input.env.GOOSEBERRY_PROTECTED_STATE_ROOTS
		? configuredPathListEntries(
				input.env.GOOSEBERRY_PROTECTED_STATE_ROOTS,
				"GOOSEBERRY_PROTECTED_STATE_ROOTS",
			)
		: [];
	return [
		...explicit,
		input.env.GOOSEBERRY_DATA_DIR,
		input.env.GOOSEBERRY_STATE_ROOT,
		input.env.GOOSEBERRY_BROWSER_DATA_DIR,
		resolve(home, ".secrets"),
	]
		.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		.map((value) => resolve(value));
}

export function isProtectedPath(
	path: string,
	input: { env: NodeJS.ProcessEnv; roots?: readonly string[] },
): boolean {
	const roots = input.roots ?? protectedStateRoots({ env: input.env });
	return roots.some((root) => within(root, resolve(path)));
}
