import { safeBrowserURL } from "@gooseberry/contracts";
import { Link as LinkIcon } from "lucide-react";
import type { ToolRenderProps } from "../../render/tool-registry";
import { CodeBlock } from "../code-block";
import { Collapsible, countLines } from "../collapsible";
import { resultText, strArg } from "../tool-helpers";

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
}

function firstUrl(args: Record<string, unknown>): string {
	const single = strArg(args, "url");
	if (single) return single;
	const many = args.urls;
	return Array.isArray(many) && typeof many[0] === "string" ? many[0] : "";
}

export function WebFetchCard({ args, result, status }: ToolRenderProps) {
	const url = firstUrl(args);
	const safeURL = safeBrowserURL(url);
	const label = safeURL ? hostOf(safeURL) : url || "fetch";
	const output = resultText(result, status === "error");

	return (
		<div data-testid="tool-fetch_content" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs tr-text-metadata">
				<LinkIcon className="size-3.5 shrink-0 text-text-muted" />
				{safeURL ? (
					<a
						href={safeURL}
						target="_blank"
						rel="noreferrer"
						className="truncate text-primary hover:underline"
						title={safeURL}
					>
						{label}
					</a>
				) : (
					<span className="truncate text-primary" title={url || undefined}>
						{label}
					</span>
				)}
			</div>
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">Fetching…</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">{output}</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<CodeBlock code={output} lang="markdown" />
				</Collapsible>
			) : (
				<span className="text-text-muted tr-text-metadata italic">(no content)</span>
			)}
		</div>
	);
}
