import { GitFork } from "lucide-react";
import type { ToolRenderProps } from "../../toolRegistry";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";

interface ChildResult {
	runId?: string;
	agent?: string;
	task?: string;
	exitCode?: number;
	error?: string;
	finalOutput?: string;
	outputState?: string;
}

interface SubagentDetails {
	mode?: string;
	runId?: string;
	asyncId?: string;
	background?: boolean;
	results?: ChildResult[];
	completions?: Array<{ runId?: string; success?: boolean; agent?: string; error?: string }>;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function childOf(value: unknown): ChildResult | undefined {
	const record = recordOf(value);
	if (!record) return undefined;
	return {
		...(typeof record.runId === "string" ? { runId: record.runId } : {}),
		...(typeof record.agent === "string" ? { agent: record.agent } : {}),
		...(typeof record.task === "string" ? { task: record.task } : {}),
		...(typeof record.exitCode === "number" ? { exitCode: record.exitCode } : {}),
		...(typeof record.error === "string" ? { error: record.error } : {}),
		...(typeof record.finalOutput === "string" ? { finalOutput: record.finalOutput } : {}),
		...(typeof record.outputState === "string" ? { outputState: record.outputState } : {}),
	};
}

export function subagentDetails(result: unknown): SubagentDetails {
	const raw = recordOf(recordOf(result)?.details);
	if (!raw) return {};
	const rawResults = Array.isArray(raw.results) ? raw.results : [];
	const rawCompletions = Array.isArray(raw.completions) ? raw.completions : [];
	return {
		...(typeof raw.mode === "string" ? { mode: raw.mode } : {}),
		...(typeof raw.runId === "string" ? { runId: raw.runId } : {}),
		...(typeof raw.asyncId === "string" ? { asyncId: raw.asyncId } : {}),
		...(typeof raw.background === "boolean" ? { background: raw.background } : {}),
		...(rawResults.length > 0
			? {
					results: rawResults
						.map(childOf)
						.filter((child): child is ChildResult => child !== undefined),
				}
			: {}),
		...(rawCompletions.length > 0
			? {
					completions: rawCompletions
						.map((value) => {
							const completion = recordOf(value);
							if (!completion) return undefined;
							return {
								...(typeof completion.runId === "string" ? { runId: completion.runId } : {}),
								...(typeof completion.success === "boolean" ? { success: completion.success } : {}),
								...(typeof completion.agent === "string" ? { agent: completion.agent } : {}),
								...(typeof completion.error === "string" ? { error: completion.error } : {}),
							};
						})
						.filter(
							(value): value is NonNullable<SubagentDetails["completions"]>[number] =>
								value !== undefined,
						),
				}
			: {}),
	};
}

function childLabel(child: ChildResult, index: number): string {
	const label = child.agent || `child ${index + 1}`;
	if (child.error) return `${label}: failed — ${child.error}`;
	if (child.exitCode !== undefined && child.exitCode !== 0)
		return `${label}: exited ${child.exitCode}`;
	if (child.outputState === "absent") return `${label}: completed without output`;
	return `${label}: completed`;
}

export function SubagentCard({ args, result, status }: ToolRenderProps) {
	const details = subagentDetails(result);
	const agent = strArg(args, "agent");
	const task = strArg(args, "task");
	const action = strArg(args, "action");
	const output = resultText(result);
	const children = details.results ?? [];
	const completions = details.completions ?? [];
	const title = action ? `action: ${action}` : agent || "delegation";

	return (
		<div data-testid="tool-subagent" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs tr-text-metadata">
				<GitFork className="size-3.5 shrink-0 text-text-muted" />
				<span className="truncate text-primary" title={task || title}>
					{title}
				</span>
				{details.mode ? <span className="shrink-0 text-text-muted">{details.mode}</span> : null}
				{details.runId ? <span className="truncate text-text-muted">{details.runId}</span> : null}
			</div>
			{task ? <p className="truncate text-text-muted tr-text-metadata">{task}</p> : null}
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">
					{details.background || details.asyncId
						? "Subagent running in background…"
						: "Subagent running…"}
				</span>
			) : null}
			{children.length > 0 ? (
				<ul
					data-testid="tool-subagent-children"
					className="flex flex-col gap-0.5 text-text-muted tr-text-metadata"
				>
					{children.map((child, index) => (
						<li
							key={`${child.runId ?? child.agent ?? "child"}-${child.task ?? ""}-${child.exitCode ?? ""}`}
						>
							{childLabel(child, index)}
						</li>
					))}
				</ul>
			) : null}
			{completions.length > 0 ? (
				<span className="text-text-muted tr-text-metadata">
					{completions.length} subagent completion{completions.length === 1 ? "" : "s"} received.
				</span>
			) : null}
			{status === "error" ? (
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">
					{output || "Subagent failed."}
				</pre>
			) : status !== "running" && output ? (
				<Collapsible lines={countLines(output)}>
					<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-header-bg p-sm tr-code-text text-text-default">
						{output}
					</pre>
				</Collapsible>
			) : null}
		</div>
	);
}
