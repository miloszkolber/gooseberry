import { Check, Copy, Pilcrow } from "lucide-react";
import { useMemo, useState } from "react";
import { copyText } from "@/lib/utils";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, useAppStore } from "../store";
import { getTransport } from "../transport";
import { splitPath } from "./changesModel";
import { simpleUnifiedDiff } from "./lineDiff";
import { SourceDiff } from "./SourceDiff";
import { useLiveTabContent } from "./useLiveTabContent";

export function DiffPane({ tab }: { tab: DiffTab }) {
	const setDiffTabIgnoreWhitespace = useAppStore((state) => state.setDiffTabIgnoreWhitespace);
	const [copied, setCopied] = useState(false);
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, tab));

	useLiveTabContent(
		tab,
		{
			read: () =>
				getTransport().request("git.diffFile", {
					workspaceId: tab.workspaceId,
					path: tab.path,
					scope: tab.scope,
				}),
			applyFresh: ({ original, modified }, tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(tab.workspaceId, tab.id, original, modified, tick, targetRef),
			keepCurrent: (tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(
						tab.workspaceId,
						tab.id,
						tab.original,
						tab.modified,
						tick,
						tab.loadedTarget,
					),
		},
		targetRef,
		tab.loadedTarget,
	);

	const ignoreWhitespace = tab.ignoreWhitespace ?? false;
	const { dir, base } = splitPath(tab.path);
	const diff = useMemo(
		() => simpleUnifiedDiff(tab.path, tab.original, tab.modified, ignoreWhitespace),
		[ignoreWhitespace, tab.modified, tab.original, tab.path],
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
					title={tab.path}
					className="mr-auto flex min-w-0 items-baseline tr-code-text"
				>
					{dir ? <span className="min-w-0 shrink truncate text-text-muted">{dir}</span> : null}
					<span className="max-w-full shrink-0 truncate text-text-muted">{base}</span>
				</span>
				<button
					type="button"
					data-testid="diff-toggle-whitespace"
					data-active={ignoreWhitespace || undefined}
					aria-pressed={ignoreWhitespace}
					aria-label="Hide whitespace changes"
					title="Hide whitespace changes"
					onClick={() => setDiffTabIgnoreWhitespace(tab.id, !ignoreWhitespace)}
					className="flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[active]:bg-control-bg-selected data-[active]:text-text-default"
				>
					<Pilcrow className="size-3.5" />
				</button>
				<button
					type="button"
					data-testid="diff-copy"
					aria-label="Copy file contents"
					title="Copy file contents"
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
				<SourceDiff
					path={tab.path}
					original={tab.original}
					modified={tab.modified}
					ignoreWhitespace={ignoreWhitespace}
				/>
			</div>
		</div>
	);
}
