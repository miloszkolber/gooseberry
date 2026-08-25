const packages = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
] as const;

async function stableVersions(name: string): Promise<Set<string>> {
	const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
	if (!response.ok) throw new Error(`Could not read ${name}: ${response.status}`);
	const metadata = (await response.json()) as { versions?: Record<string, unknown> };
	return new Set(
		Object.keys(metadata.versions ?? {}).filter((version) => /^\d+\.\d+\.\d+$/.test(version)),
	);
}

const sets = await Promise.all(packages.map(stableVersions));
const common = [...(sets[0] ?? [])].filter((version) => sets.every((set) => set.has(version)));
const parts = (version: string) => version.split(".").map(Number);
common.sort((a, b) => {
	const left = parts(a);
	const right = parts(b);
	return (
		(right[0] ?? 0) - (left[0] ?? 0) ||
		(right[1] ?? 0) - (left[1] ?? 0) ||
		(right[2] ?? 0) - (left[2] ?? 0)
	);
});
const newest = common[0];
if (!newest) throw new Error("No common stable Pi-family release exists.");

const file = new URL("../package.json", import.meta.url);
const manifest = (await Bun.file(file).json()) as {
	workspaces: { catalog: Record<string, string> };
};
for (const name of packages) manifest.workspaces.catalog[name] = newest;
await Bun.write(file, `${JSON.stringify(manifest, null, "\t")}\n`);
console.log(newest);
