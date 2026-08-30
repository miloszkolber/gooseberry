import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface ManifestEntry {
	file: string;
	imports?: string[];
	isEntry?: boolean;
}

const MAX_INITIAL_JAVASCRIPT_BYTES = 500_000;
const manifest = JSON.parse(readFileSync(join("dist", ".vite", "manifest.json"), "utf8")) as Record<
	string,
	ManifestEntry
>;
const entries = Object.entries(manifest).filter(([, entry]) => entry.isEntry);
if (entries.length !== 1)
	throw new Error(`Expected one Web UI entry bundle, found ${entries.length}`);

const visited = new Set<string>();
function javascriptBytes(key: string): number {
	if (visited.has(key)) return 0;
	visited.add(key);
	const entry = manifest[key];
	if (!entry) throw new Error(`Bundle manifest references missing entry: ${key}`);
	const own = entry.file.endsWith(".js") ? statSync(join("dist", entry.file)).size : 0;
	return (
		own +
		(entry.imports ?? []).reduce((total, dependency) => total + javascriptBytes(dependency), 0)
	);
}

const initialBytes = javascriptBytes(entries[0]?.[0] ?? "");
if (initialBytes > MAX_INITIAL_JAVASCRIPT_BYTES) {
	throw new Error(
		`Initial JavaScript is ${initialBytes} bytes; budget is ${MAX_INITIAL_JAVASCRIPT_BYTES} bytes`,
	);
}
console.log(`bundle-budget: ${initialBytes}/${MAX_INITIAL_JAVASCRIPT_BYTES} initial JS bytes`);
