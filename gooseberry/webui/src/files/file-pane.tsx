import { lazy, Suspense, useState } from "react";
import { ToggleSegment } from "../components/toggle-segment";
import { getTransport } from "../connection";
import { isMarkdownPath } from "../lib/utils";
import type { FileTab } from "../store";
import { useAppStore } from "../store";
import { isImagePath } from "./file-kind";
import { projectFileUrl } from "./markdown-links";
import { SourcePreview } from "./source-preview";
import { useLiveTabContent } from "./use-live-tab-content";

const MarkdownPreview = lazy(() => import("./markdown-preview"));

const loading = (
	<div className="flex h-full items-center justify-center text-text-muted">Loading…</div>
);

export function FilePane({ tab }: { tab: FileTab }) {
	const image = isImagePath(tab.path);
	// loadedTick also acknowledges unrelated changes; only relevant reads reload the image.
	const [imageRevision, setImageRevision] = useState(tab.loadedTick ?? 0);
	const setFileTabView = useAppStore((state) => state.setFileTabView);
	const rootIndex = useAppStore(
		(state) =>
			state.projects.find((project) => project.id === tab.projectAreaId)?.roots.indexOf(tab.root) ??
			-1,
	);

	useLiveTabContent(tab, {
		read: () =>
			image
				? Promise.resolve({ content: "" })
				: getTransport().request("fs.readFile", {
						projectId: tab.projectAreaId,
						root: tab.root,
						path: tab.path,
					}),
		applyFresh: ({ content }, tick) => {
			if (image) setImageRevision(tick);
			useAppStore.getState().updateFileTabContent(tab.projectAreaId, tab.id, content, tick);
		},
		keepCurrent: (tick) =>
			useAppStore.getState().updateFileTabContent(tab.projectAreaId, tab.id, tab.content, tick),
	});
	if (image) {
		const url = projectFileUrl(
			getTransport().httpBase(),
			tab.projectAreaId,
			rootIndex,
			"",
			tab.path,
		);
		const source = url ? `${url}?v=${imageRevision}` : undefined;
		return (
			<div className="flex h-full min-h-0 flex-col">
				<ReadOnlyToolbar path={tab.path} />
				<ImagePreview key={source} source={source} name={tab.name} />
			</div>
		);
	}
	if (tab.content.includes("\0")) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				<ReadOnlyToolbar path={tab.path} />
				<p className="p-lg tr-text-ui text-text-muted">
					Binary file — text preview is unavailable.
				</p>
			</div>
		);
	}

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
							root={tab.root}
							rootIndex={rootIndex}
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

function ImagePreview({ source, name }: { source: string | undefined; name: string }) {
	const [failed, setFailed] = useState(false);
	return failed || !source ? (
		<p role="alert" className="p-lg tr-text-ui text-text-muted">
			Image preview is unavailable. The file may have changed, exceeded the preview limit, or left
			the project roots.
		</p>
	) : (
		<div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-md">
			<img
				src={source}
				alt={name}
				onError={() => setFailed(true)}
				className="max-h-full max-w-full object-contain"
			/>
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
