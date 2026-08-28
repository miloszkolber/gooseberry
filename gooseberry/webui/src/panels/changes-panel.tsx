import type { GitDiffScope, GitRepository } from "@gooseberry/contracts";
import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	matchesChangePath,
	selectActiveContentTab,
	type TabIntent,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { ChangeRowActions } from "./change-row-actions";
import { splitPath, statusNameClass } from "./changes-model";
import { ChangesTree } from "./changes-tree";
import { DiffStatBadge } from "./diff-stat-badge";
import { openDiffInTab } from "./open-tabs";
import { ToggleSegment } from "./toggle-segment";
import { useProjectRead } from "./use-project-read";

const SCOPE: GitDiffScope = { kind: "uncommitted" };

export function ChangesPanel({ projectAreaId }: { projectAreaId: string }) {
	const [repositories, setRepositories] = useState<GitRepository[]>([]);
	const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
	const status =
		repositories.find((repository) => repository.root === selectedRepository) ??
		repositories[0] ??
		null;
	const [error, setError] = useState<string | null>(null);
	const warnedRef = useRef(false);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const changesRequest = useAppStore((state) => state.changesRequest);
	const changesView = useAppStore((state) => state.changesView);
	const setChangesView = useAppStore((state) => state.setChangesView);
	const activeDiffTab = useAppStore((state) => {
		const tab = selectActiveContentTab(state, projectAreaId);
		return tab?.kind === "diff" ? tab : null;
	});

	const { reload } = useProjectRead(
		projectAreaId,
		(id) => getTransport().request("git.listRepositories", { projectId: id }),
		{
			onResult: (result) => {
				setRepositories(result);
				setSelectedRepository((current) =>
					result.some((repository) => repository.root === current)
						? current
						: (result[0]?.root ?? null),
				);
				setError(null);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				if (repositories.length > 0 && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(`Could not refresh the changes: ${errorText(failure)}`);
				}
				setError(errorText(failure));
			},
			onSwitch: () => {
				setRepositories([]);
				setSelectedRepository(null);
				setError(null);
				setHighlighted(null);
				warnedRef.current = false;
			},
		},
	);

	const openDiff = useCallback(
		(path: string, intent: TabIntent) => {
			setHighlighted(path);
			if (status) void openDiffInTab(projectAreaId, SCOPE, path, intent, undefined, status.root);
		},
		[status, projectAreaId],
	);

	useEffect(() => {
		if (!status || changesRequest?.projectAreaId !== projectAreaId) return;
		if (useAppStore.getState().changesRequest !== changesRequest) return;
		const match = status.changes.find((change) =>
			matchesChangePath(changesRequest.path, change.path),
		);
		if (match) openDiff(match.path, "preview");
		else setHighlighted(changesRequest.path);
		useAppStore.getState().clearChangesRequest();
	}, [changesRequest, openDiff, status, projectAreaId]);

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
					{repositories.length > 1 ? (
						<select
							aria-label="Git repository"
							value={status?.root ?? ""}
							onChange={(event) => setSelectedRepository(event.target.value)}
							className="min-w-0 bg-transparent text-text-muted"
						>
							{repositories.map((repository) => (
								<option key={repository.id} value={repository.root}>
									{repository.relativePath || repository.name}
								</option>
							))}
						</select>
					) : (
						<span className="truncate">
							{status
								? status.head.kind === "branch"
									? status.head.name
									: status.head.oid.slice(0, 8)
								: "Git changes"}
						</span>
					)}
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
					<p className="px-sm py-xs tr-text-metadata text-text-muted">No Git repositories found.</p>
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
