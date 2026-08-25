import type { GitDiffScope, GitStatus } from "@mewa-code/contracts";
import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	matchesWorktreePath,
	selectActiveEditorTab,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { ChangeRowActions } from "./ChangeRowActions";
import { ChangesTree } from "./ChangesTree";
import { splitPath, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { openDiffInTab } from "./openTabs";
import { ToggleSegment } from "./ToggleSegment";
import { useWorkspaceRead } from "./useWorkspaceRead";

const SCOPE: GitDiffScope = { kind: "uncommitted" };

export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const warnedRef = useRef(false);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const changesRequest = useAppStore((state) => state.changesRequest);
	const changesView = useAppStore((state) => state.changesView);
	const setChangesView = useAppStore((state) => state.setChangesView);
	const activeDiffTab = useAppStore((state) => {
		const tab = selectActiveEditorTab(state, workspaceId);
		return tab?.kind === "diff" ? tab : null;
	});

	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.status", { workspaceId: id, scope: SCOPE }),
		{
			onResult: (result) => {
				setStatus(result);
				setError(null);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(`Could not refresh the changes: ${errorText(failure)}`);
				}
				setError(errorText(failure));
			},
			onSwitch: () => {
				setStatus(null);
				setError(null);
				setHighlighted(null);
				warnedRef.current = false;
			},
		},
	);

	const openDiff = useCallback(
		(path: string, intent: TabIntent) => {
			setHighlighted(path);
			void openDiffInTab(workspaceId, SCOPE, path, intent);
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!status || changesRequest?.workspaceId !== workspaceId) return;
		if (useAppStore.getState().changesRequest !== changesRequest) return;
		const match = status.changes.find((change) =>
			matchesWorktreePath(changesRequest.path, change.path),
		);
		if (match) openDiff(match.path, "preview");
		else setHighlighted(changesRequest.path);
		useAppStore.getState().clearChangesRequest();
	}, [changesRequest, openDiff, status, workspaceId]);

	useEffect(() => {
		if (activeDiffTab) setHighlighted(null);
	}, [activeDiffTab]);

	const isActive = (path: string) =>
		activeDiffTab?.path === path || (!activeDiffTab && highlighted === path);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex h-panel-header-row shrink-0 items-center gap-xs border-border-default border-b px-sm">
				<div className="mr-auto flex min-w-0 items-center gap-xs tr-text-metadata text-text-muted">
					<GitBranch className="size-3.5 shrink-0" />
					<span className="truncate">{status?.branch || "Git changes"}</span>
				</div>
				<button
					type="button"
					aria-label="Refresh changes"
					title="Refresh changes"
					onClick={reload}
					className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<RefreshCw className="size-3.5" />
				</button>
				<ToggleSegment
					testid="changes-toggle-list"
					label="List"
					active={changesView === "list"}
					onClick={() => setChangesView("list")}
				/>
				<ToggleSegment
					testid="changes-toggle-tree"
					label="Tree"
					active={changesView === "tree"}
					onClick={() => setChangesView("tree")}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{status === null && error !== null ? (
					<div className="flex flex-col items-start gap-xs px-sm py-xs">
						<p className="tr-text-metadata text-feedback-error">
							Could not read the changes: {error}
						</p>
						<button
							type="button"
							onClick={reload}
							className="rounded-[var(--radius-sm)] px-xs py-0.5 tr-text-metadata text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							Retry
						</button>
					</div>
				) : status === null ? (
					<p className="px-sm py-xs tr-text-metadata text-text-muted">Loading…</p>
				) : status.changes.length === 0 ? (
					<p data-testid="changes-empty" className="px-sm py-xs tr-text-metadata text-text-muted">
						Working tree is clean.
					</p>
				) : changesView === "tree" ? (
					<ChangesTree changes={status.changes} onOpen={openDiff} isActive={isActive} />
				) : (
					<ul>
						{status.changes.map((change) => {
							const { dir, base } = splitPath(change.path);
							return (
								<li key={change.path}>
									<ChangeRowActions
										path={change.path}
										active={isActive(change.path)}
										onView={() => openDiff(change.path, "preview")}
									>
										{({ onContextMenu }) => (
											<button
												type="button"
												onContextMenu={onContextMenu}
												data-testid="change-item"
												data-status={change.status}
												data-active={isActive(change.path) || undefined}
												onClick={() => openDiff(change.path, "preview")}
												onDoubleClick={() => openDiff(change.path, "keep")}
												title={change.path}
												className="flex min-w-0 flex-1 items-center gap-sm px-sm py-xs text-left tr-text-ui"
											>
												<span className="flex min-w-0 flex-1 items-baseline">
													{dir ? (
														<span className="min-w-0 shrink truncate text-text-muted">{dir}</span>
													) : null}
													<span
														className={`max-w-full shrink-0 truncate ${statusNameClass(change.status) || "text-text-muted"}`}
													>
														{base}
													</span>
												</span>
												<DiffStatBadge added={change.added ?? 0} removed={change.removed ?? 0} />
											</button>
										)}
									</ChangeRowActions>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</div>
	);
}
