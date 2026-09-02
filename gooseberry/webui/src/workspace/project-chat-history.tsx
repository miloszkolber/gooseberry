import type { SessionSummary } from "@gooseberry/contracts";
import { Archive, ArchiveRestore, History, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ArchiveSessionDialog,
	RenameSessionDialog,
	type SessionLifecycleTarget,
	unsupportedLifecycleReason,
} from "../chat/session-lifecycle-controls";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { errorText, getTransport } from "../connection";
import { relativeTime } from "../lib";
import { type ClosedChat, toast, useAppStore } from "../store";
import { openChatInTab } from "./open-chat";

export function ProjectChatHistory({ projectAreaId }: { projectAreaId: string }) {
	const closed = useAppStore(
		(state) => state.closedChatsByProjectArea[projectAreaId] ?? EMPTY_CHATS,
	);
	const catalogVersion = useAppStore(
		(state) => state.sessionCatalogVersionByProjectArea[projectAreaId] ?? 0,
	);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const status = useAppStore((state) => state.status);
	const agentProfile = useAppStore((state) => state.agentProfile);
	const canRename = agentProfile?.operations.renameSession === true;
	const canArchive = agentProfile?.operations.archiveSession === true;
	const canDelete = agentProfile?.operations.deleteSession === true;
	const renameUnavailable = canRename
		? undefined
		: unsupportedLifecycleReason(agentProfile?.name, "renaming");
	const archiveUnavailable = canArchive
		? undefined
		: unsupportedLifecycleReason(agentProfile?.name, "archiving");
	const deleteUnavailable = canDelete
		? undefined
		: unsupportedLifecycleReason(agentProfile?.name, "deleting");
	const unavailableActions = [renameUnavailable, archiveUnavailable, deleteUnavailable].filter(
		(reason): reason is string => !!reason,
	);
	const [open, setOpen] = useState(false);
	const [archived, setArchived] = useState<SessionSummary[]>([]);
	const [archivedLoading, setArchivedLoading] = useState(false);
	const [archivedError, setArchivedError] = useState(false);
	const [restoring, setRestoring] = useState<string | null>(null);
	const [renameTarget, setRenameTarget] = useState<SessionLifecycleTarget | null>(null);
	const [archiveTarget, setArchiveTarget] = useState<SessionLifecycleTarget | null>(null);
	const loadSequence = useRef(0);
	useEffect(() => {
		if (!canRename) setRenameTarget(null);
		if (!canArchive) setArchiveTarget(null);
	}, [canArchive, canRename]);

	const loadArchived = useCallback(async () => {
		if (!canArchive) return;
		const sequence = ++loadSequence.current;
		setArchivedLoading(true);
		try {
			const sessions = await getTransport().request("session.list", {
				projectId: projectAreaId,
				archived: true,
			});
			if (sequence !== loadSequence.current) return;
			setArchived(sessions);
			setArchivedError(false);
		} catch {
			if (sequence === loadSequence.current) setArchivedError(true);
		} finally {
			if (sequence === loadSequence.current) setArchivedLoading(false);
		}
	}, [canArchive, projectAreaId]);

	useEffect(() => {
		void catalogVersion;
		void connectionGeneration;
		if (open && status === "connected" && canArchive) void loadArchived();
	}, [canArchive, catalogVersion, connectionGeneration, loadArchived, open, status]);

	const restore = (sessionId: string) => {
		if (!canArchive) return;
		setRestoring(sessionId);
		void getTransport()
			.request("session.unarchive", { projectId: projectAreaId, sessionId })
			.then(() => {
				setArchived((current) => current.filter((session) => session.sessionId !== sessionId));
				useAppStore.getState().applySessionLifecycle({
					projectId: projectAreaId,
					sessionId,
					operation: "unarchived",
				});
			})
			.catch((cause) => toast.error(errorText(cause), "Couldn't restore the chat"))
			.finally(() => setRestoring((current) => (current === sessionId ? null : current)));
	};

	return (
		<>
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger
					data-testid="chat-history"
					aria-label="View chat history"
					title="View chat history"
					className="flex w-7 shrink-0 items-center justify-center border-border-default border-l text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					<History className="size-4" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-[18rem]">
					<DropdownMenuLabel>Recently closed</DropdownMenuLabel>
					{closed.length === 0 ? (
						<p className="px-sm py-xs text-text-muted tr-text-metadata">No recently closed chats</p>
					) : (
						closed.map((chat) => (
							<DropdownMenuGroup
								key={chat.sessionId}
								data-testid="closed-chat-row"
								className="flex items-center"
							>
								<DropdownMenuItem
									data-testid="closed-chat-item"
									data-session-id={chat.sessionId}
									onSelect={() => void openChatInTab(projectAreaId, chat.sessionId)}
									className="min-w-0 flex-1"
								>
									<span className="flex-1 truncate">{chat.title}</span>
									<span className="shrink-0 tr-text-metadata text-text-muted">
										{relativeTime(chat.closedAt)}
									</span>
									<RotateCcw className="size-3.5 shrink-0 text-text-muted" />
								</DropdownMenuItem>
								<DropdownMenuItem
									aria-label={
										renameUnavailable
											? `Rename ${chat.title}: ${renameUnavailable}`
											: `Rename ${chat.title}`
									}
									disabled={!canRename}
									title={renameUnavailable ?? "Rename chat"}
									onSelect={() =>
										setRenameTarget({
											projectId: projectAreaId,
											sessionId: chat.sessionId,
											title: chat.title,
										})
									}
									className="shrink-0 px-xs text-text-muted"
								>
									<Pencil className="size-3.5" />
								</DropdownMenuItem>
								<DropdownMenuItem
									aria-label={
										archiveUnavailable
											? `Archive ${chat.title}: ${archiveUnavailable}`
											: `Archive ${chat.title}`
									}
									disabled={!canArchive}
									title={archiveUnavailable ?? "Archive chat"}
									onSelect={() =>
										setArchiveTarget({
											projectId: projectAreaId,
											sessionId: chat.sessionId,
											title: chat.title,
										})
									}
									className="shrink-0 px-xs text-text-muted"
								>
									<Archive className="size-3.5" />
								</DropdownMenuItem>
								<DropdownMenuItem
									data-testid="closed-chat-delete"
									aria-label={
										deleteUnavailable
											? `Move ${chat.title} to trash: ${deleteUnavailable}`
											: `Move ${chat.title} to trash`
									}
									disabled={!canDelete}
									title={deleteUnavailable ?? "Move chat to trash"}
									onSelect={() => {
										if (!canDelete) return;
										void getTransport()
											.request("session.delete", {
												projectId: projectAreaId,
												sessionId: chat.sessionId,
											})
											.then(() => useAppStore.getState().deleteChat(projectAreaId, chat.sessionId))
											.catch((cause) => {
												const state = useAppStore.getState();
												if (
													!state.removedProjectAreaIds[projectAreaId] &&
													!state.deletedSessionsByProjectArea[projectAreaId]?.[chat.sessionId]
												) {
													toast.error(errorText(cause), "Couldn't delete the chat");
												}
											});
									}}
									className="shrink-0 px-xs text-text-muted focus:text-feedback-error"
								>
									<Trash2 className="size-3.5" />
								</DropdownMenuItem>
							</DropdownMenuGroup>
						))
					)}
					{unavailableActions.map((reason) => (
						<p key={reason} className="max-w-[18rem] px-sm py-xs text-text-muted tr-text-metadata">
							{reason}
						</p>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuLabel>Archived</DropdownMenuLabel>
					{!canArchive ? (
						<p className="max-w-[18rem] px-sm py-xs text-text-muted tr-text-metadata">
							{archiveUnavailable}
						</p>
					) : archivedLoading ? (
						<p
							role="status"
							aria-live="polite"
							className="px-sm py-xs text-text-muted tr-text-metadata"
						>
							Loading archived chats…
						</p>
					) : archivedError ? (
						<DropdownMenuItem
							aria-label="Retry loading archived chats"
							onSelect={() => void loadArchived()}
						>
							Couldn't load archived chats · Retry
						</DropdownMenuItem>
					) : archived.length === 0 ? (
						<p className="px-sm py-xs text-text-muted tr-text-metadata">No archived chats</p>
					) : (
						archived.map((session) => (
							<DropdownMenuItem
								key={session.sessionId}
								disabled={restoring === session.sessionId}
								aria-label={
									restoring === session.sessionId
										? `Restoring ${session.title}`
										: `Restore ${session.title}`
								}
								onSelect={() => restore(session.sessionId)}
							>
								<span className="min-w-0 flex-1 truncate">{session.title}</span>
								<span className="shrink-0 text-text-muted tr-text-metadata">
									{relativeTime(session.updatedAt)}
								</span>
								<ArchiveRestore className="size-3.5" />
							</DropdownMenuItem>
						))
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{renameTarget ? (
				<RenameSessionDialog
					target={renameTarget}
					open
					onOpenChange={(next) => !next && setRenameTarget(null)}
				/>
			) : null}
			{archiveTarget ? (
				<ArchiveSessionDialog
					target={archiveTarget}
					open
					onOpenChange={(next) => !next && setArchiveTarget(null)}
				/>
			) : null}
		</>
	);
}

const EMPTY_CHATS: ClosedChat[] = [];
