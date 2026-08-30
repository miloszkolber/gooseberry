import { Brain } from "lucide-react";
import type { ToolRenderProps } from "../../tool-registry";
import { Collapsible, countLines } from "../collapsible";
import { resultText, strArg } from "../tool-helpers";

interface SignetDetails {
	error?: string;
	memoriesFound?: number;
	sourcesFound?: number;
	sessionsFound?: number;
	memoriesSaved?: number;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function signetDetails(result: unknown): SignetDetails {
	const raw = recordOf(recordOf(result)?.details);
	if (!raw) return {};
	return {
		...(typeof raw.error === "string" ? { error: raw.error } : {}),
		...(typeof raw.memoriesFound === "number" ? { memoriesFound: raw.memoriesFound } : {}),
		...(typeof raw.sourcesFound === "number" ? { sourcesFound: raw.sourcesFound } : {}),
		...(typeof raw.sessionsFound === "number" ? { sessionsFound: raw.sessionsFound } : {}),
		...(typeof raw.memoriesSaved === "number" ? { memoriesSaved: raw.memoriesSaved } : {}),
	};
}

function titleFor(toolName: string): string {
	if (toolName === "signet_remember") return "save memory";
	if (toolName === "signet_source_search") return "source search";
	if (toolName === "signet_session_search") return "session search";
	return "memory recall";
}

function runningLabel(toolName: string): string {
	if (toolName === "signet_remember") return "Saving memory…";
	if (toolName === "signet_source_search") return "Searching sources…";
	if (toolName === "signet_session_search") return "Searching sessions…";
	return "Recalling memory…";
}

export function SignetCard({ toolName, args, result, status }: ToolRenderProps) {
	const details = signetDetails(result);
	const query = strArg(args, "query") || strArg(args, "content");
	const output = resultText(result, status === "error");
	const offline = details.error === "daemon_offline";
	const count =
		details.memoriesFound ?? details.sourcesFound ?? details.sessionsFound ?? details.memoriesSaved;

	return (
		<div data-testid="tool-signet" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs tr-text-metadata">
				<Brain className="size-3.5 shrink-0 text-text-muted" />
				<span className="text-primary">{titleFor(toolName)}</span>
				{count !== undefined ? (
					<span className="shrink-0 text-text-muted">
						{count} result{count === 1 ? "" : "s"}
					</span>
				) : null}
			</div>
			{query ? <p className="truncate text-text-muted tr-text-metadata">{query}</p> : null}
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">{runningLabel(toolName)}</span>
			) : offline ? (
				<span data-testid="tool-signet-offline" className="text-text-muted tr-text-metadata">
					Signet daemon unavailable. Memory integration is disabled for this turn.
				</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">
					{output || "Signet request failed."}
				</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-header-bg p-sm tr-code-text text-text-default">
						{output}
					</pre>
				</Collapsible>
			) : null}
		</div>
	);
}
