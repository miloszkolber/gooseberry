import type { SessionStats } from "@gooseberry/contracts";
import type { ReactNode } from "react";
import { SessionStatsBar } from "./session-stats-bar";

export function ChatHeader({
	stats,
	statusEntries,
	left,
}: {
	stats: SessionStats | null;
	statusEntries: [string, string][];
	left?: ReactNode;
}) {
	return (
		<div
			data-testid="chat-toolbar"
			className="flex min-h-panel-header-row shrink-0 flex-wrap items-center gap-xs border-border-muted border-b bg-container-project-bg px-sm py-xs"
		>
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-xs">{left}</div>
			<div className="flex min-w-0 flex-wrap items-center justify-end gap-md">
				{statusEntries.map(([key, text]) => (
					<span
						key={key}
						title={text}
						className="max-w-40 truncate text-text-muted tr-text-metadata sm:max-w-64"
					>
						{text}
					</span>
				))}
				<SessionStatsBar stats={stats} />
			</div>
		</div>
	);
}
