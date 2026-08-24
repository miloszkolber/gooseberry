export function binaryArtifactName(target?: string): string {
	const base = target ? `mewa-code-${target.replace(/^bun-/, "")}` : "mewa-code";
	const windows = target ? target.includes("windows") : process.platform === "win32";
	return windows ? `${base}.exe` : base;
}
