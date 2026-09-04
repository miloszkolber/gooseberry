import type {
	GooseExtensionSummary,
	GooseToolPermission,
	GooseToolSummary,
} from "@gooseberry/contracts";

export const permissionLabel: Record<GooseToolPermission, string> = {
	always_allow: "Always allow",
	ask_before: "Ask first",
	never_allow: "Never allow",
};

export function uniqueExtensions(extensions: GooseExtensionSummary[]): GooseExtensionSummary[] {
	const seen = new Set<string>();
	return extensions.filter(
		(extension) => !seen.has(extension.name) && Boolean(seen.add(extension.name)),
	);
}

export function filterTools(tools: readonly GooseToolSummary[], query: string): GooseToolSummary[] {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return [...tools];
	return tools.filter((tool) =>
		`${tool.name} ${tool.description} ${tool.parameters.join(" ")}`
			.toLocaleLowerCase()
			.includes(needle),
	);
}

export function extensionWarningText(warningCount: number): string | null {
	if (warningCount === 0) return null;
	return `${warningCount} Goose configuration ${warningCount === 1 ? "warning" : "warnings"} reported.`;
}

export function isSessionInventoryCurrent(
	loadedTarget: string | null,
	activeTarget: string,
	loading: boolean,
): boolean {
	return !loading && loadedTarget === activeTarget;
}
