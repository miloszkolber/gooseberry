import { lazy, Suspense } from "react";
import { isMarkdownPath } from "@/lib/utils";
import type { FileTab } from "../store";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { SourcePreview } from "./source-preview";
import { ToggleSegment } from "./toggle-segment";
import { useLiveTabContent } from "./use-live-tab-content";

const MarkdownPreview = lazy(() => import("./markdown-preview"));

const loading = (
	<div className="flex h-full items-center justify-center text-text-muted">Loading…</div>
);

export function FilePane({ tab }: { tab: FileTab }) {
	const setFileTabView = useAppStore((state) => state.setFileTabView);

	useLiveTabContent(tab, {
		read: () =>
			getTransport().request("fs.readFile", {
				projectId: tab.projectAreaId,
				root: tab.root,
				path: tab.path,
			}),
		applyFresh: ({ content }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.projectAreaId, tab.id, content, tick),
		keepCurrent: (tick) =>
			useAppStore.getState().updateFileTabContent(tab.projectAreaId, tab.id, tab.content, tick),
	});

	if (!isMarkdownPath(tab.path)) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				<ReadOnlyToolbar path={tab.path} />
				<div className="min-h-0 flex-1">
					<SourcePreview path={tab.path} content={tab.content} />
				</div>
			</div>
		);
	}

	const view = tab.view ?? "rendered";
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="markdown-view-toggle"
				role="toolbar"
				aria-label="Markdown view mode"
				className="flex h-8 shrink-0 items-center gap-xs border-border-default border-b bg-container-header-bg px-sm"
			>
				<span
					className="mr-auto min-w-0 truncate text-text-muted tr-text-metadata"
					title={tab.path}
				>
					{tab.path}
				</span>
				<span className="text-text-subtle tr-text-metadata">Read-only</span>
				<ToggleSegment
					testid="md-toggle-preview"
					label="Preview"
					active={view === "rendered"}
					onClick={() => setFileTabView(tab.id, "rendered")}
				/>
				<ToggleSegment
					testid="md-toggle-source"
					label="Source"
					active={view === "source"}
					onClick={() => setFileTabView(tab.id, "source")}
				/>
			</div>
			<div className="min-h-0 flex-1">
				{view === "rendered" ? (
					<Suspense fallback={loading}>
						<MarkdownPreview
							content={tab.content}
							projectAreaId={tab.projectAreaId}
							path={tab.path}
						/>
					</Suspense>
				) : (
					<SourcePreview path={tab.path} content={tab.content} />
				)}
			</div>
		</div>
	);
}

function ReadOnlyToolbar({ path }: { path: string }) {
	return (
		<div className="flex h-8 shrink-0 items-center gap-sm border-border-default border-b bg-container-header-bg px-sm">
			<span className="min-w-0 flex-1 truncate text-text-muted tr-text-metadata" title={path}>
				{path}
			</span>
			<span className="text-text-subtle tr-text-metadata">Read-only</span>
		</div>
	);
}
