import type { SessionPlanState } from "@gooseberry/contracts";
import { ListChecks } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PlanStatusIcon } from "./plan-kit";

function planProgress(planState: SessionPlanState): { completed: number; total: number } {
	return {
		completed: planState.entries.filter((entry) => entry.status === "completed").length,
		total: planState.entries.length,
	};
}

function statusLabel(status: SessionPlanState["entries"][number]["status"]): string {
	if (status === "in_progress") return "In progress";
	if (status === "completed") return "Completed";
	return "Pending";
}

function iconStatus(
	status: SessionPlanState["entries"][number]["status"],
): "pending" | "active" | "done" {
	if (status === "in_progress") return "active";
	if (status === "completed") return "done";
	return "pending";
}

export function SessionPlanContent({ planState }: { planState: SessionPlanState }) {
	const progress = planProgress(planState);
	const keyOccurrences = new Map<string, number>();
	const hasEntries = planState.entries.length > 0;
	return (
		<div data-testid="session-plan-content" className="flex flex-col gap-sm p-md">
			<div className="flex items-baseline justify-between gap-md">
				<h2 className="tr-title-entity text-text-default">Session plan</h2>
				{hasEntries ? (
					<span className="shrink-0 tr-text-metadata text-text-muted">
						{progress.completed} of {progress.total} complete
					</span>
				) : null}
			</div>
			{hasEntries ? (
				<ol className="flex max-h-72 flex-col gap-xs overflow-y-auto" aria-label="Plan steps">
					{planState.entries.map((entry) => {
						const baseKey = `${entry.status}:${entry.priority}:${entry.content}`;
						const occurrence = (keyOccurrences.get(baseKey) ?? 0) + 1;
						keyOccurrences.set(baseKey, occurrence);
						return (
							<li
								key={`${baseKey}:${occurrence}`}
								className="flex items-start gap-xs rounded-[var(--radius-xs)] px-xs py-2xs"
							>
								<span className="mt-0.5" title={statusLabel(entry.status)}>
									<PlanStatusIcon kind={iconStatus(entry.status)} />
								</span>
								<span
									className={`min-w-0 flex-1 break-words tr-text-ui ${
										entry.status === "completed"
											? "text-text-muted line-through"
											: "text-text-default"
									}`}
								>
									<span className="sr-only">{statusLabel(entry.status)}: </span>
									{entry.content}
								</span>
								<span className="shrink-0 capitalize tr-text-metadata text-text-muted">
									{entry.priority}
								</span>
							</li>
						);
					})}
				</ol>
			) : null}
			{planState.truncated ? (
				<p role="status" className="tr-text-metadata text-feedback-warning">
					Plan shortened to fit display limits.
				</p>
			) : null}
		</div>
	);
}

export function SessionPlanControl({ planState }: { planState: SessionPlanState | null }) {
	if (!planState || (planState.entries.length === 0 && !planState.truncated)) return null;
	const progress = planProgress(planState);
	const hasEntries = planState.entries.length > 0;
	const label = hasEntries
		? `Session plan, ${progress.completed} of ${progress.total} complete${planState.truncated ? ", shortened to fit display limits" : ""}`
		: "Session plan, shortened to fit display limits";

	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-testid="session-plan-trigger"
					aria-label={label}
					className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-xs py-0.5 tr-text-metadata text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					<ListChecks className="size-3.5" aria-hidden />
					<span>{hasEntries ? `${progress.completed}/${progress.total}` : "Limited"}</span>
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(90vw,30rem)]">
				<SessionPlanContent planState={planState} />
			</PopoverContent>
		</Popover>
	);
}
