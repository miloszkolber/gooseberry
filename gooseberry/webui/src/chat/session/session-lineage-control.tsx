import { GitFork } from "lucide-react";
import { openChatInTab } from "../../workspace/navigation/open-chat";

export function SessionLineageControl({
	projectAreaId,
	parentSessionId,
	parentDeleted,
}: {
	projectAreaId: string;
	parentSessionId?: string | undefined;
	parentDeleted: boolean;
}) {
	if (!parentSessionId) return null;
	const unavailable = parentDeleted;
	return (
		<button
			type="button"
			disabled={unavailable}
			aria-label={unavailable ? "Forked from an unavailable chat" : "Open parent chat"}
			title={unavailable ? "Parent chat is unavailable" : "Open parent chat"}
			onClick={() => void openChatInTab(projectAreaId, parentSessionId)}
			className="flex min-w-0 shrink items-center gap-2xs rounded-[var(--radius-sm)] px-xs py-2xs text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default disabled:cursor-not-allowed disabled:opacity-70"
		>
			<GitFork className="size-3 shrink-0" />
			<span className="truncate">Forked from chat</span>
		</button>
	);
}
