import { GitFork } from "lucide-react";
import type { ToolRenderProps } from "../../toolRegistry";
import { Collapsible, countLines } from "../Collapsible";
import { resultText, strArg } from "../toolHelpers";

type ChildStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

interface ChildModel {
	provider?: string;
	id?: string;
}

interface ChildResult {
	runId?: string;
	agent?: "child";
	task?: string;
	status?: ChildStatus | undefined;
	model?: ChildModel | null;
	thinkingLevel?: string;
	currentTool?: string;
	finalOutput?: string;
	outputState?: "present" | "absent";
	truncated?: boolean;
	error?: string;
}

export interface SubagentDetails {
	mode?: "single";
	runId?: string;
	parentSessionId?: string;
	childSessionId?: string;
	status?: ChildStatus | undefined;
	results?: ChildResult[];
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function statusOf(value: unknown): ChildStatus | undefined {
	return value === "starting" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
		? value
		: undefined;
}

function childOf(value: unknown): ChildResult | undefined {
	const record = recordOf(value);
	if (!record) return undefined;
	const model = recordOf(record.model);
	const status = statusOf(record.status);
	return {
		...(typeof record.runId === "string" ? { runId: record.runId } : {}),
		...(record.agent === "child" ? { agent: "child" as const } : {}),
		...(typeof record.task === "string" ? { task: record.task } : {}),
		...(status ? { status } : {}),
		...(record.model === null
			? { model: null }
			: model
				? {
						model: {
							...(typeof model.provider === "string" ? { provider: model.provider } : {}),
							...(typeof model.id === "string" ? { id: model.id } : {}),
						},
					}
				: {}),
		...(typeof record.thinkingLevel === "string" ? { thinkingLevel: record.thinkingLevel } : {}),
		...(typeof record.currentTool === "string" ? { currentTool: record.currentTool } : {}),
		...(typeof record.finalOutput === "string" ? { finalOutput: record.finalOutput } : {}),
		...(record.outputState === "present" || record.outputState === "absent"
			? { outputState: record.outputState }
			: {}),
		...(record.truncated === true ? { truncated: true } : {}),
		...(typeof record.error === "string" ? { error: record.error } : {}),
	};
}

export function subagentDetails(result: unknown): SubagentDetails {
	const raw = recordOf(recordOf(result)?.details);
	if (!raw) return {};
	const rawResults = Array.isArray(raw.results) ? raw.results : [];
	const status = statusOf(raw.status);
	return {
		...(raw.mode === "single" ? { mode: "single" as const } : {}),
		...(typeof raw.runId === "string" ? { runId: raw.runId } : {}),
		...(typeof raw.parentSessionId === "string" ? { parentSessionId: raw.parentSessionId } : {}),
		...(typeof raw.childSessionId === "string" ? { childSessionId: raw.childSessionId } : {}),
		...(status ? { status } : {}),
		...(rawResults.length > 0
			? {
					results: rawResults
						.map(childOf)
						.filter((child): child is ChildResult => child !== undefined),
				}
			: {}),
	};
}

function childStatus(details: SubagentDetails): ChildStatus | undefined {
	return details.status ?? details.results?.[0]?.status;
}

function statusLabel(
	status: ChildStatus | undefined,
	currentTool?: string,
	error?: string,
): string {
	switch (status) {
		case "starting":
			return "Starting child…";
		case "running":
			return currentTool ? `Child running · ${currentTool}` : "Child running";
		case "completed":
			return "Child completed";
		case "failed":
			return error ? `Child failed · ${error}` : "Child failed";
		case "cancelled":
			return "Child cancelled";
		default:
			return "Subagent running…";
	}
}

function modelLabel(
	model: ChildModel | null | undefined,
	thinkingLevel: string | undefined,
): string {
	const modelName = model?.provider && model.id ? `${model.provider}/${model.id}` : undefined;
	return [modelName, thinkingLevel].filter(Boolean).join(" · ");
}

export function SubagentCard({ args, result, status }: ToolRenderProps) {
	const details = subagentDetails(result);
	const child = details.results?.[0];
	const task = strArg(args, "task") || child?.task;
	const output = resultText(result);
	const currentStatus = childStatus(details) ?? (status === "error" ? "failed" : undefined);
	const sessionId = details.childSessionId || details.runId || child?.runId;
	const model = modelLabel(child?.model, child?.thinkingLevel);
	const label = statusLabel(currentStatus, child?.currentTool, child?.error);

	return (
		<div data-testid="tool-subagent" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs tr-text-metadata">
				<GitFork className="size-3.5 shrink-0 text-text-muted" />
				<span className="truncate text-primary" title={task || "subagent"}>
					{subagentSummary(args)}
				</span>
				{sessionId ? <span className="truncate text-text-muted">{sessionId}</span> : null}
			</div>
			{task ? <p className="truncate text-text-muted tr-text-metadata">{task}</p> : null}
			<span className="text-text-muted tr-text-metadata">{label}</span>
			{model ? <span className="text-text-muted tr-text-metadata">{model}</span> : null}
			{child?.truncated ? (
				<span className="text-text-muted tr-text-metadata">Output truncated</span>
			) : null}
			{status === "error" || currentStatus === "failed" ? (
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">
					{child?.error || output || "Child failed."}
				</pre>
			) : currentStatus === "completed" && output ? (
				<Collapsible lines={countLines(output)}>
					<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-header-bg p-sm tr-code-text text-text-default">
						{output}
					</pre>
				</Collapsible>
			) : null}
		</div>
	);
}

function subagentSummary(args: Record<string, unknown>): string {
	return strArg(args, "task") || "subagent";
}
