import type { GitBranchRef, GitCommit, GitDiffScope, GitHead } from "@gooseberry/contracts";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { errorText, getTransport } from "../../connection";
import { useProjectRead } from "../../workspace/projects/use-project-read";
import { scopeLabel } from "./changes-model";

type CommitHistory = { commits: GitCommit[] } | { error: string } | null;
type BranchCatalog = { branches: GitBranchRef[]; truncated: boolean } | { error: string } | null;

export function GitScopeMenu({
	projectAreaId,
	repository,
	head,
	scope,
	onSelect,
}: {
	projectAreaId: string;
	repository: string;
	head: GitHead;
	scope: GitDiffScope;
	onSelect: (scope: GitDiffScope) => void;
}) {
	const [open, setOpen] = useState(false);
	const [branches, setBranches] = useState<BranchCatalog>(null);
	const [history, setHistory] = useState<CommitHistory>(null);
	const { reload: reloadBranches } = useProjectRead(
		open && head.kind !== "unborn" ? projectAreaId : null,
		(id) => getTransport().request("git.listBranches", { projectId: id, repository }),
		{
			onResult: setBranches,
			onFailure: (_id, error) => setBranches({ error: errorText(error) }),
			onSwitch: () => setBranches(null),
		},
		repository,
	);
	const { reload } = useProjectRead(
		open ? projectAreaId : null,
		(id) => getTransport().request("git.listCommits", { projectId: id, repository }),
		{
			onResult: setHistory,
			onFailure: (_id, error) => setHistory({ error: errorText(error) }),
			onSwitch: () => setHistory(null),
		},
		repository,
	);
	const select = (next: GitDiffScope) => {
		onSelect(next);
		setOpen(false);
	};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={`Review scope: ${scopeLabel(scope)}`}
					className="flex min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-0.5 tr-text-metadata text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				>
					<span className="truncate">{scopeLabel(scope)}</span>
					<ChevronDown className="size-3 shrink-0" />
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-sm">
				<button
					type="button"
					onClick={() => select({ kind: "uncommitted" })}
					className="mb-sm w-full rounded-[var(--radius-sm)] px-sm py-xs text-left tr-text-ui text-text-default hover:bg-control-bg-hovered"
				>
					Uncommitted changes
				</button>
				<BranchPicker
					catalog={branches}
					head={head}
					initialSelection={scope.kind === "branch" ? scope.baseRef : ""}
					onSelect={select}
					onRetry={() => {
						setBranches(null);
						reloadBranches();
					}}
				/>
				<CommitPicker
					history={history}
					initialSelection={
						scope.kind === "commit" ? scope.sha : scope.kind === "pinned" ? scope.baseRef : ""
					}
					onSelect={select}
					onRetry={() => {
						setHistory(null);
						reload();
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

export function BranchPicker({
	catalog,
	head,
	initialSelection,
	onSelect,
	onRetry,
}: {
	catalog: BranchCatalog;
	head: GitHead;
	initialSelection: string;
	onSelect: (scope: GitDiffScope) => void;
	onRetry: () => void;
}) {
	const [selection, setSelection] = useState(initialSelection);
	if (head.kind === "unborn") {
		return (
			<p
				role="status"
				className="border-border-default border-t px-sm py-sm tr-text-metadata text-text-muted"
			>
				Create the first commit before comparing branches.
			</p>
		);
	}
	if (catalog === null) {
		return (
			<p
				role="status"
				className="border-border-default border-t px-sm py-sm tr-text-metadata text-text-muted"
			>
				Loading branches…
			</p>
		);
	}
	if ("error" in catalog) {
		return (
			<div className="border-border-default border-t px-sm py-sm">
				<p role="alert" className="tr-text-metadata text-feedback-error">
					Could not read branches: {catalog.error}
				</p>
				<button
					type="button"
					onClick={onRetry}
					className="mt-xs rounded-[var(--radius-sm)] px-xs py-0.5 tr-text-metadata text-text-muted hover:bg-control-bg-hovered"
				>
					Retry
				</button>
			</div>
		);
	}
	const currentRef = head.kind === "branch" ? `refs/heads/${head.name}` : null;
	if (catalog.branches.length === 0) {
		return (
			<p
				role="status"
				className="border-border-default border-t px-sm py-sm tr-text-metadata text-text-muted"
			>
				No branches found.
			</p>
		);
	}
	const selected = catalog.branches.find(
		(branch) => branch.ref === selection && branch.ref !== currentRef,
	);
	return (
		<div className="flex flex-col gap-sm border-border-default border-t px-sm py-sm">
			<label className="tr-text-metadata text-text-muted">
				Base branch
				<select
					aria-label="Base branch"
					value={selected?.ref ?? ""}
					onChange={(event) => setSelection(event.target.value)}
					className="mt-xs w-full min-w-0 rounded-[var(--radius-sm)] border border-border-default bg-container-content-bg px-xs py-xs tr-text-ui text-text-default"
				>
					<option value="" disabled>
						Choose a branch…
					</option>
					{catalog.branches.map((branch) => (
						<option key={branch.ref} value={branch.ref} disabled={branch.ref === currentRef}>
							{branch.name}
							{branch.ref === currentRef ? " (current)" : ""}
						</option>
					))}
				</select>
			</label>
			<button
				type="button"
				disabled={!selected}
				onClick={() => selected && onSelect({ kind: "branch", baseRef: selected.ref })}
				className="self-start rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered disabled:opacity-50"
			>
				Compare branch
			</button>
			{catalog.truncated ? (
				<p className="tr-text-metadata text-text-muted">Some branches are not shown.</p>
			) : null}
		</div>
	);
}

export function CommitPicker({
	history,
	initialSelection,
	onSelect,
	onRetry,
}: {
	history: CommitHistory;
	initialSelection: string;
	onSelect: (scope: GitDiffScope) => void;
	onRetry: () => void;
}) {
	const [selection, setSelection] = useState(initialSelection);
	if (history === null) {
		return (
			<p role="status" className="px-sm py-xs tr-text-metadata text-text-muted">
				Loading commits…
			</p>
		);
	}
	if ("error" in history) {
		return (
			<div className="px-sm py-xs">
				<p role="alert" className="tr-text-metadata text-feedback-error">
					Could not read commits: {history.error}
				</p>
				<button
					type="button"
					onClick={onRetry}
					className="mt-xs rounded-[var(--radius-sm)] px-xs py-0.5 tr-text-metadata text-text-muted hover:bg-control-bg-hovered"
				>
					Retry
				</button>
			</div>
		);
	}
	if (history.commits.length === 0) {
		return (
			<p role="status" className="px-sm py-xs tr-text-metadata text-text-muted">
				No commits yet.
			</p>
		);
	}
	const selected = history.commits.find((commit) => commit.sha === selection);
	return (
		<div className="flex flex-col gap-sm border-border-default border-t px-sm pt-sm">
			<label className="tr-text-metadata text-text-muted">
				Recent commit
				<select
					aria-label="Recent commit"
					value={selected?.sha ?? ""}
					onChange={(event) => setSelection(event.target.value)}
					className="mt-xs w-full min-w-0 rounded-[var(--radius-sm)] border border-border-default bg-container-content-bg px-xs py-xs tr-text-ui text-text-default"
				>
					<option value="" disabled>
						Choose a commit…
					</option>
					{history.commits.map((commit) => (
						<option key={commit.sha} value={commit.sha}>
							{commit.shortSha} · {commit.subject}
						</option>
					))}
				</select>
			</label>
			<div className="flex flex-wrap gap-xs">
				<button
					type="button"
					disabled={!selected}
					onClick={() => selected && onSelect({ kind: "commit", sha: selected.sha })}
					className="rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered disabled:opacity-50"
				>
					View commit
				</button>
				<button
					type="button"
					disabled={!selected}
					onClick={() => selected && onSelect({ kind: "pinned", baseRef: selected.sha })}
					className="rounded-[var(--radius-sm)] px-sm py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered disabled:opacity-50"
				>
					Compare with working tree
				</button>
			</div>
			{history.commits.length === 200 ? (
				<p className="tr-text-metadata text-text-muted">Showing the latest 200 commits.</p>
			) : null}
		</div>
	);
}
