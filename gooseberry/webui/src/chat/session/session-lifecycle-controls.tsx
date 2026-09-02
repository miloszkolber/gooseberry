import { normalizeSessionTitle, SESSION_TITLE_MAX_LENGTH } from "@gooseberry/contracts";
import { Archive, GitFork, MoreHorizontal, Pencil } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { Button } from "../../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { errorText, getTransport } from "../../connection";
import { toast, useAppStore } from "../../store";
import { openChatInTab } from "../../workspace/navigation/open-chat";

export interface SessionLifecycleTarget {
	projectId: string;
	sessionId: string;
	title: string;
}

export function forkActionState(
	streaming: boolean,
	busy: boolean,
	supported = true,
	agentName = "The connected agent",
): {
	disabled: boolean;
	label: string;
	title?: string;
} {
	return {
		disabled: !supported || streaming || busy,
		label: busy ? "Forking…" : "Fork",
		...(!supported
			? { title: `${agentName} does not support forking chats` }
			: streaming
				? { title: "Stop the running chat before forking it" }
				: {}),
	};
}

export function unsupportedLifecycleReason(
	agentName: string | undefined,
	action: "renaming" | "archiving" | "deleting",
): string {
	return `${agentName || "The connected agent"} does not support ${action} chats`;
}

export function RenameSessionDialog({
	target,
	open,
	onOpenChange,
}: {
	target: SessionLifecycleTarget;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [title, setTitle] = useState(target.title);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setTitle(target.title);
		setError(null);
	}, [open, target.title]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		let normalized: string;
		try {
			normalized = normalizeSessionTitle(title);
		} catch (cause) {
			setError(errorText(cause));
			return;
		}
		setBusy(true);
		setError(null);
		void getTransport()
			.request("session.rename", {
				projectId: target.projectId,
				sessionId: target.sessionId,
				title: normalized,
			})
			.then(() => {
				useAppStore.getState().applySessionLifecycle({
					projectId: target.projectId,
					sessionId: target.sessionId,
					operation: "renamed",
					title: normalized,
				});
				onOpenChange(false);
			})
			.catch((cause) => setError(errorText(cause)))
			.finally(() => setBusy(false));
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
			<DialogContent data-testid="session-rename-dialog" className="max-w-[24rem]">
				<form className="flex flex-col gap-lg" onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>Rename chat</DialogTitle>
						<DialogDescription>The title is stored with this agent session.</DialogDescription>
					</DialogHeader>
					<label className="flex flex-col gap-xs tr-text-ui text-text-default">
						<span>Title</span>
						<input
							autoFocus
							value={title}
							maxLength={SESSION_TITLE_MAX_LENGTH}
							disabled={busy}
							onChange={(event) => setTitle(event.target.value)}
							className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
						/>
					</label>
					{error ? (
						<p role="alert" className="text-feedback-error tr-text-metadata">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy} data-testid="session-rename-submit">
							{busy ? "Renaming…" : "Rename"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function ArchiveSessionDialog({
	target,
	open,
	onOpenChange,
}: {
	target: SessionLifecycleTarget;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Archive this chat?"
			description="The agent will retain the conversation. You can restore it from chat history."
			confirmLabel="Archive"
			confirmTestId="session-archive-confirm"
			onConfirm={() => {
				void getTransport()
					.request("session.archive", {
						projectId: target.projectId,
						sessionId: target.sessionId,
					})
					.then(() =>
						useAppStore.getState().applySessionLifecycle({
							projectId: target.projectId,
							sessionId: target.sessionId,
							operation: "archived",
						}),
					)
					.catch((cause) => toast.error(errorText(cause), "Couldn't archive the chat"));
			}}
		/>
	);
}

export function SessionLifecycleMenu({
	target,
	streaming,
}: {
	target: SessionLifecycleTarget;
	streaming: boolean;
}) {
	const [renameOpen, setRenameOpen] = useState(false);
	const [archiveOpen, setArchiveOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [forkBusy, setForkBusy] = useState(false);
	const [forkError, setForkError] = useState<string | null>(null);
	const agentProfile = useAppStore((state) => state.agentProfile);
	const canFork = agentProfile?.operations.forkSession === true;
	const canRename = agentProfile?.operations.renameSession === true;
	const canArchive = agentProfile?.operations.archiveSession === true;
	const forkAction = forkActionState(streaming, forkBusy, canFork, agentProfile?.name);
	const renameUnavailable = canRename
		? undefined
		: unsupportedLifecycleReason(agentProfile?.name, "renaming");
	const archiveUnavailable = canArchive
		? undefined
		: unsupportedLifecycleReason(agentProfile?.name, "archiving");
	const unavailableActions = [
		forkAction.disabled ? forkAction.title : undefined,
		renameUnavailable,
		archiveUnavailable ?? (streaming ? "Stop the running chat before archiving it" : undefined),
	].filter((reason): reason is string => !!reason);
	useEffect(() => {
		if (!canRename) setRenameOpen(false);
		if (!canArchive) setArchiveOpen(false);
	}, [canArchive, canRename]);
	const fork = () => {
		if (!canFork) return;
		setForkBusy(true);
		setForkError(null);
		void getTransport()
			.request("session.fork", { projectId: target.projectId, sessionId: target.sessionId })
			.then(async (summary) => {
				useAppStore.getState().applySessionLifecycle({
					projectId: target.projectId,
					sessionId: summary.sessionId,
					operation: "forked",
				});
				setMenuOpen(false);
				await openChatInTab(target.projectId, summary.sessionId);
			})
			.catch((cause) => setForkError(errorText(cause)))
			.finally(() => setForkBusy(false));
	};
	return (
		<>
			<DropdownMenu
				open={menuOpen}
				onOpenChange={(open) => {
					if (!forkBusy) setMenuOpen(open);
				}}
			>
				<DropdownMenuTrigger
					aria-label={`Chat actions for ${target.title}`}
					className="px-xs text-text-muted outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					<MoreHorizontal className="size-3.5" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						data-testid="session-fork"
						disabled={forkAction.disabled}
						title={forkAction.title}
						aria-label={forkAction.title ? `Fork: ${forkAction.title}` : "Fork"}
						onSelect={(event) => {
							event.preventDefault();
							fork();
						}}
					>
						<GitFork className="size-3.5" /> {forkAction.label}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canRename}
						title={renameUnavailable}
						aria-label={renameUnavailable ? `Rename: ${renameUnavailable}` : "Rename"}
						onSelect={() => setRenameOpen(true)}
					>
						<Pencil className="size-3.5" /> Rename
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={!canArchive || streaming}
						title={
							archiveUnavailable ??
							(streaming ? "Stop the running chat before archiving it" : undefined)
						}
						aria-label={
							archiveUnavailable
								? `Archive: ${archiveUnavailable}`
								: streaming
									? "Archive: Stop the running chat before archiving it"
									: "Archive"
						}
						onSelect={() => setArchiveOpen(true)}
					>
						<Archive className="size-3.5" /> Archive
					</DropdownMenuItem>
					{unavailableActions.map((reason) => (
						<p key={reason} className="max-w-64 px-sm py-xs text-text-muted tr-text-metadata">
							{reason}
						</p>
					))}
					{forkError ? (
						<p role="alert" className="max-w-64 px-sm py-xs text-feedback-error tr-text-metadata">
							{forkError}
						</p>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<RenameSessionDialog target={target} open={renameOpen} onOpenChange={setRenameOpen} />
			<ArchiveSessionDialog target={target} open={archiveOpen} onOpenChange={setArchiveOpen} />
		</>
	);
}
