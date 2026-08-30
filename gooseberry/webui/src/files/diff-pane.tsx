import { Check, Copy, Pilcrow } from "lucide-react";
import { useMemo, useState } from "react";
import { getTransport } from "../connection";
import { copyText } from "../lib/utils";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, useAppStore } from "../store";
import { splitPath } from "./changes-model";
import { simpleUnifiedDiff } from "./line-diff";
import { SourceDiff } from "./source-diff";
import { useLiveTabContent } from "./use-live-tab-content";

export function DiffPane({ tab }: { tab: DiffTab }) {
	const setDiffTabIgnoreWhitespace = useAppStore((state) => state.setDiffTabIgnoreWhitespace);
	const [copied, setCopied] = useState(false);
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, tab));

	useLiveTabContent(
		tab,
		{
			read: () =>
				getTransport().request("git.diffFile", {
					projectId: tab.projectAreaId,
					repository: tab.repository,
					path: tab.path,
					scope: tab.scope,
				}),
			applyFresh: (preview, tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(tab.projectAreaId, tab.id, preview, tick, targetRef),
			keepCurrent: (tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(tab.projectAreaId, tab.id, tab, tick, tab.loadedTarget),
		},
		targetRef,
		tab.loadedTarget,
	);

	const ignoreWhitespace = tab.ignoreWhitespace ?? false;
	const unavailable = tab.unavailable || tab.binary || tab.tooLarge;
	const notice =
		tab.message ||
		(tab.binary
			? "Binary files cannot be previewed"
			: tab.tooLarge
				? "File is too large to preview"
				: "File is unavailable for preview");
	const { dir, base } = splitPath(tab.path);
	const diff = useMemo(
		() =>
			unavailable
				? ""
				: simpleUnifiedDiff(
						tab.path,
						tab.original,
						tab.modified,
						ignoreWhitespace,
						tab.originalPath,
					),
		[ignoreWhitespace, tab.modified, tab.original, tab.path, tab.originalPath, unavailable],
	);
	const copy = async () => {
		if (!(await copyText(diff))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1_500);
	};

	return (
		<div data-testid="diff-pane" className="flex h-full min-h-0 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-xs border-border-default border-b bg-container-header-bg px-sm">
				<span
					data-testid="diff-path"
					title={tab.originalPath ? `${tab.originalPath} → ${tab.path}` : tab.path}
					className="mr-auto flex min-w-0 items-baseline tr-code-text"
				>
					{tab.originalPath ? (
						<span className="min-w-0 truncate text-text-muted">{tab.originalPath} → </span>
					) : null}
					{dir ? <span className="min-w-0 shrink truncate text-text-muted">{dir}</span> : null}
					<span className="max-w-full shrink-0 truncate text-text-muted">{base}</span>
				</span>
				<button
					type="button"
					data-testid="diff-toggle-whitespace"
					data-active={ignoreWhitespace || undefined}
					aria-pressed={ignoreWhitespace}
					aria-label="Hide whitespace changes"
					disabled={unavailable}
					title="Hide whitespace changes"
					onClick={() => setDiffTabIgnoreWhitespace(tab.id, !ignoreWhitespace)}
					className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[active]:bg-control-bg-selected data-[active]:text-text-default"
				>
					<Pilcrow className="size-3.5" />
				</button>
				<button
					type="button"
					data-testid="diff-copy"
					aria-label="Copy diff"
					title="Copy diff"
					disabled={unavailable}
					onClick={() => void copy()}
					className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
				>
					{copied ? (
						<Check className="size-3.5 text-feedback-success" />
					) : (
						<Copy className="size-3.5" />
					)}
				</button>
			</div>
			<div className="min-h-0 flex-1">
				{unavailable ? (
					<p role="status" className="p-lg tr-text-ui text-text-muted">
						{notice}
					</p>
				) : (
					<SourceDiff
						path={tab.path}
						originalPath={tab.originalPath}
						original={tab.original}
						modified={tab.modified}
						ignoreWhitespace={ignoreWhitespace}
					/>
				)}
			</div>
		</div>
	);
}
