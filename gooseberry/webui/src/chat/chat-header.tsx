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
			className="flex h-panel-header-row shrink-0 items-center gap-md overflow-clip border-border-muted border-b bg-container-projectArea-bg px-sm"
		>
			<div className="flex min-w-0 flex-1 items-center overflow-clip">{left}</div>
			<div className="flex min-w-0 items-center justify-end gap-md overflow-clip">
				{statusEntries.map(([key, text]) => (
					<span key={key} className="shrink-0 whitespace-nowrap text-text-muted tr-text-metadata">
						{text}
					</span>
				))}
				<SessionStatsBar stats={stats} />
			</div>
		</div>
	);
}
