import type { GitDiffScope, GitRepository } from "@gooseberry/contracts";
import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ToggleSegment } from "../../components/toggle-segment";
import { errorText, getTransport } from "../../connection";
import { tupleKey } from "../../lib";
import {
	matchesChangePath,
	selectActiveContentTab,
	selectDiffScope,
	type TabIntent,
	toast,
	useAppStore,
} from "../../store";
import { useProjectRead } from "../../workspace/projects/use-project-read";
import { openDiffInTab } from "../tabs/open-tabs";
import { ChangeRowActions } from "./change-row-actions";
import { branchName, scopeKey, splitPath, statusNameClass } from "./changes-model";
import { ChangesTree } from "./changes-tree";
import { DiffStatBadge } from "./diff-stat-badge";
import { GitScopeMenu } from "./git-scope-menu";

const UNCOMMITTED_SCOPE: GitDiffScope = { kind: "uncommitted" };

export function ChangesPanel({
	projectAreaId,
	onOpen,
}: {
	projectAreaId: string;
	onOpen?: () => void;
}) {
	const [catalog, setCatalog] = useState<{
		projectAreaId: string;
		repositories: GitRepository[];
	} | null>(null);
	const repositories = catalog?.projectAreaId === projectAreaId ? catalog.repositories : [];
	const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
	const repository =
		repositories.find((repository) => repository.root === selectedRepository) ??
		repositories[0] ??
		null;
	const scope = useAppStore((state) => selectDiffScope(state, projectAreaId));
	const setDiffScope = useAppStore((state) => state.setDiffScope);
	const readKey = tupleKey(projectAreaId, repository?.root ?? "", scopeKey(scope));
	const [scoped, setScoped] = useState<{
		key: string;
		status?: GitRepository;
		error?: string;
	} | null>(null);
	const status =
		scope.kind === "uncommitted"
			? repository
			: scoped?.key === readKey
				? (scoped.status ?? null)
				: null;
	const [error, setError] = useState<string | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);
	const warnedRef = useRef(false);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const changesRequest = useAppStore((state) => state.changesRequest);
	const changesView = useAppStore((state) => state.changesView);
	const setChangesView = useAppStore((state) => state.setChangesView);
	const activeDiffTab = useAppStore((state) => {
		const tab = selectActiveContentTab(state, projectAreaId);
		return tab?.kind === "diff" &&
			tab.repository === repository?.root &&
			scopeKey(tab.scope) === scopeKey(scope)
			? tab
			: null;
	});

	const { reload } = useProjectRead(
		projectAreaId,
		(id) => getTransport().request("git.listRepositories", { projectId: id }),
		{
			onResult: (result, id) => {
				setCatalog({ projectAreaId: id, repositories: result.repositories });
				setWarnings(result.warnings);
				const next = result.repositories.some(
					(repository) => repository.root === selectedRepository,
				)
					? selectedRepository
					: (result.repositories[0]?.root ?? null);
				if (selectedRepository !== null && next !== selectedRepository)
					setDiffScope(id, UNCOMMITTED_SCOPE);
				setSelectedRepository(next);
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
				setCatalog(null);
				setSelectedRepository(null);
				setError(null);
				setWarnings([]);
				setHighlighted(null);
				warnedRef.current = false;
			},
		},
	);
	const { reload: reloadScoped } = useProjectRead(
		repository && scope.kind !== "uncommitted" ? projectAreaId : null,
		(id) =>
			getTransport().request("git.status", {
				projectId: id,
				repository: repository?.root ?? "",
				scope,
			}),
		{
			onResult: (result, id) => {
				setScoped({ key: readKey, status: result });
				if (scope.kind === "branch" && result.comparisonId) {
					useAppStore.getState().noteDiffComparison(id, result.root, scope, result.comparisonId);
				}
			},
			onFailure: (_id, failure) => setScoped({ key: readKey, error: errorText(failure) }),
			onSwitch: () => setScoped(null),
		},
		readKey,
	);
	const refresh = () => {
		reload();
		reloadScoped();
	};
	const visibleError = error ?? (scoped?.key === readKey ? scoped.error : null);
	const loadingScope =
		repository !== null && scope.kind !== "uncommitted" && scoped?.key !== readKey;
	const loadingRepositories = catalog?.projectAreaId !== projectAreaId && error === null;

	const openDiff = useCallback(
		(path: string, intent: TabIntent) => {
			setHighlighted(path);
			if (status)
				void openDiffInTab(
					projectAreaId,
					scope,
					path,
					intent,
					undefined,
					status.root,
					status.comparisonId,
				).then((opened) => {
					if (opened) onOpen?.();
				});
		},
		[status, projectAreaId, scope, onOpen],
	);

	useEffect(() => {
		if (changesRequest?.projectAreaId !== projectAreaId) return;
		if (useAppStore.getState().changesRequest !== changesRequest) return;
		if (scope.kind !== "uncommitted") {
			setDiffScope(projectAreaId, UNCOMMITTED_SCOPE);
			return;
		}
		if (!status) return;
		const match = status.changes.find((change) =>
			matchesChangePath(changesRequest.path, change.path),
		);
		if (match) openDiff(match.path, "preview");
		else setHighlighted(changesRequest.path);
		useAppStore.getState().clearChangesRequest();
	}, [changesRequest, openDiff, status, projectAreaId, scope, setDiffScope]);

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
							value={repository?.root ?? ""}
							onChange={(event) => {
								setSelectedRepository(event.target.value);
								setDiffScope(projectAreaId, UNCOMMITTED_SCOPE);
							}}
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
							{repository
								? repository.head.kind === "branch"
									? branchName(`refs/heads/${repository.head.name}`)
									: repository.head.kind === "detached"
										? repository.head.oid.slice(0, 8)
										: "Unborn repository"
								: "Git changes"}
						</span>
					)}
				</div>
				<button
					type="button"
					aria-label="Refresh changes"
					title="Refresh changes"
					onClick={refresh}
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
			{repository ? (
				<div className="shrink-0 border-border-default border-b px-xs py-xs">
					<GitScopeMenu
						key={tupleKey(projectAreaId, repository.root)}
						projectAreaId={projectAreaId}
						repository={repository.root}
						head={repository.head}
						scope={scope}
						onSelect={(next) => setDiffScope(projectAreaId, next)}
					/>
				</div>
			) : null}
			<div className="min-h-0 flex-1 overflow-auto">
				{warnings.length > 0 ? (
					<p
						role="status"
						className="border-border-muted border-b px-sm py-xs tr-text-metadata text-feedback-warning"
					>
						{warnings.join(" ")}
					</p>
				) : null}
				{visibleError ? (
					<div className="flex flex-col items-start gap-xs px-sm py-xs">
						<p className="tr-text-metadata text-feedback-error">
							Could not read the changes: {visibleError}
						</p>
						<button
							type="button"
							onClick={refresh}
							className="rounded-[var(--radius-sm)] px-xs py-0.5 tr-text-metadata text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							Retry
						</button>
					</div>
				) : loadingScope || loadingRepositories ? (
					<p role="status" className="px-sm py-xs tr-text-metadata text-text-muted">
						Loading changes…
					</p>
				) : status === null ? (
					<p className="px-sm py-xs tr-text-metadata text-text-muted">No Git repositories found.</p>
				) : status.changes.length === 0 ? (
					<p data-testid="changes-empty" className="px-sm py-xs tr-text-metadata text-text-muted">
						{scope.kind === "uncommitted"
							? "Working tree is clean."
							: scope.kind === "commit"
								? "No file changes in this commit."
								: scope.kind === "branch"
									? `No committed changes from ${branchName(scope.baseRef)}.`
									: "No changes since this commit."}
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
