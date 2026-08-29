import type { ContextUsage, SessionStats } from "@gooseberry/contracts";
import { Gauge } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type UsageField = "input" | "output" | "cacheRead" | "cacheWrite" | "total" | "cost";

function isReported(stats: SessionStats, field: UsageField, value: number): boolean {
	return stats.reported ? stats.reported[field] === true : value !== 0;
}

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function usageParts(stats: SessionStats): string[] {
	const parts: string[] = [];
	if (isReported(stats, "input", stats.tokens.input))
		parts.push(`↑${formatTokens(stats.tokens.input)}`);
	if (isReported(stats, "output", stats.tokens.output))
		parts.push(`↓${formatTokens(stats.tokens.output)}`);
	if (isReported(stats, "cacheRead", stats.tokens.cacheRead))
		parts.push(`R${formatTokens(stats.tokens.cacheRead)}`);
	if (isReported(stats, "cacheWrite", stats.tokens.cacheWrite))
		parts.push(`W${formatTokens(stats.tokens.cacheWrite)}`);
	if (isReported(stats, "cost", stats.cost)) parts.push(`$${stats.cost.toFixed(3)}`);
	return parts;
}

export function contextPart(usage: ContextUsage): { bar: string; text: string } {
	const filled =
		usage.percent === null ? 0 : Math.round(Math.min(100, Math.max(0, usage.percent)) / 20);
	const contextWindow = formatTokens(usage.contextWindow);
	return {
		bar: `${"▰".repeat(filled)}${"▱".repeat(5 - filled)}`,
		text:
			usage.percent === null
				? `?/${contextWindow}`
				: `${usage.percent.toFixed(1)}%/${contextWindow}`,
	};
}

export function SessionStatsBar({ stats }: { stats: SessionStats | null }) {
	if (!stats) return null;
	const parts = usageParts(stats);
	const context = stats.contextUsage ? contextPart(stats.contextUsage) : null;
	if (parts.length === 0 && !context) return null;

	const contextPercent = stats.contextUsage?.percent;
	const progress = contextPercent === null || contextPercent === undefined ? 0 : contextPercent;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button
					type="button"
					data-testid="usage-tracker"
					className="flex shrink-0 flex-nowrap items-center justify-end gap-x-xs rounded-[var(--radius-sm)] px-xs py-0.5 text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default"
					aria-label="Open session usage"
				>
					<Gauge className="size-3.5 text-primary" />
					{isReported(stats, "total", stats.tokens.total) ? (
						<span>{formatTokens(stats.tokens.total)} tokens</span>
					) : null}
					{context ? <span>{context.text}</span> : null}
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[min(90vw,22rem)] p-md">
				<div data-testid="session-stats" className="flex flex-col gap-md">
					<div>
						<div className="tr-text-ui text-text-default">Session usage</div>
						<div className="text-text-muted tr-text-metadata">
							Reported by Goose for this controller runtime
						</div>
					</div>
					{stats.contextUsage ? (
						<div className="flex flex-col gap-xs">
							<div className="flex items-center justify-between tr-text-metadata">
								<span className="text-text-default">Context window</span>
								<span className="text-text-muted">{context?.text}</span>
							</div>
							<div
								role="progressbar"
								aria-label="Context window used"
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={Math.round(Math.min(100, Math.max(0, progress)))}
								className="h-1.5 overflow-hidden rounded-full bg-control-bg-selected"
							>
								<div
									className="h-full rounded-full bg-primary"
									style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
								/>
							</div>
						</div>
					) : null}
					<dl className="grid grid-cols-2 gap-x-lg gap-y-xs tr-text-metadata">
						{isReported(stats, "input", stats.tokens.input) ? (
							<UsageRow label="Input" value={`${stats.tokens.input.toLocaleString()} tokens`} />
						) : null}
						{isReported(stats, "output", stats.tokens.output) ? (
							<UsageRow label="Output" value={`${stats.tokens.output.toLocaleString()} tokens`} />
						) : null}
						{isReported(stats, "cacheRead", stats.tokens.cacheRead) ? (
							<UsageRow
								label="Cache read"
								value={`${stats.tokens.cacheRead.toLocaleString()} tokens`}
							/>
						) : null}
						{isReported(stats, "cacheWrite", stats.tokens.cacheWrite) ? (
							<UsageRow
								label="Cache write"
								value={`${stats.tokens.cacheWrite.toLocaleString()} tokens`}
							/>
						) : null}
						{isReported(stats, "total", stats.tokens.total) ? (
							<UsageRow label="Total" value={`${stats.tokens.total.toLocaleString()} tokens`} />
						) : null}
						{isReported(stats, "cost", stats.cost) ? (
							<UsageRow label="Cost" value={`$${stats.cost.toFixed(4)}`} />
						) : null}
					</dl>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function UsageRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="contents">
			<dt className="text-text-muted">{label}</dt>
			<dd className="text-right text-text-default tabular-nums">{value}</dd>
		</div>
	);
}
