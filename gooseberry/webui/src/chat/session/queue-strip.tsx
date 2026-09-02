import type { QueueLane, SessionQueueState } from "@gooseberry/contracts";
import { Pencil, RotateCcw, X } from "lucide-react";

export function QueueStrip({
	queue,
	onEdit,
	onRemove,
	onRetry,
}: {
	queue: SessionQueueState;
	onEdit: (kind: QueueLane, index: number) => void;
	onRemove: (kind: QueueLane, index: number) => void;
	onRetry: (kind: QueueLane, index: number) => void;
}) {
	const items = [
		...queue.steering.map((text, index) => ({
			kind: "steering" as const,
			index,
			label: "Steering",
			hint: "delivers at the agent's next step",
			text,
		})),
		...queue.followUp.map((text, index) => ({
			kind: "followUp" as const,
			index,
			label: "Follow-up",
			hint: "runs after the agent finishes",
			text,
		})),
	].map((item) => {
		const blocked = queue.blocked?.lane === item.kind && queue.blocked.index === item.index;
		return {
			...item,
			blocked,
			hint: blocked
				? "may already have been delivered; check the transcript before retrying"
				: item.hint,
		};
	});
	if (items.length === 0) return null;
	return (
		<div
			data-testid="queue-strip"
			className="flex w-full shrink-0 flex-col gap-2xs border-border-default border-t bg-container-elevated-bg px-md py-xs text-text-muted tr-text-metadata"
		>
			{items.map((item) => (
				<div
					key={`${item.kind}:${item.index}`}
					data-testid="queue-item"
					data-kind={item.kind}
					data-index={item.index}
					title={`${item.text} — ${item.hint}`}
					className={`flex w-full items-center gap-sm rounded-[var(--radius-xs)] ${item.blocked ? "bg-feedback-warning-subtle px-xs py-2xs" : ""}`}
				>
					<span className="min-w-0 flex-1 truncate">
						<span className="text-text-default">
							{item.label}
							{item.blocked ? " — may already be sent" : ""}:
						</span>{" "}
						{item.text}
					</span>
					{item.blocked ? (
						<button
							type="button"
							data-testid="queue-item-retry"
							aria-label={`Send queued message again (may duplicate): ${item.text}`}
							disabled={!queue.revision}
							onClick={() => onRetry(item.kind, item.index)}
							className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] hover:bg-control-bg-hovered hover:text-text-default"
						>
							<RotateCcw className="size-3" />
						</button>
					) : null}
					<button
						type="button"
						data-testid="queue-item-edit"
						aria-label={`Edit queued message: ${item.text}`}
						disabled={!queue.revision}
						onClick={() => onEdit(item.kind, item.index)}
						className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] hover:bg-control-bg-hovered hover:text-text-default"
					>
						<Pencil className="size-3" />
					</button>
					<button
						type="button"
						data-testid="queue-item-remove"
						aria-label={`Remove queued message: ${item.text}`}
						disabled={!queue.revision}
						onClick={() => onRemove(item.kind, item.index)}
						className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-xs)] hover:bg-control-bg-hovered hover:text-text-default"
					>
						<X className="size-3" />
					</button>
				</div>
			))}
		</div>
	);
}
