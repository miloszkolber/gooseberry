import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { isMarkdownPath } from "@/lib/utils";
import type { FileTab } from "../store";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";

const MonacoEditor = lazy(() => import("./MonacoEditor"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

const loading = (
	<div className="flex h-full items-center justify-center text-text-muted">Loading…</div>
);

export function FilePane({ tab }: { tab: FileTab }) {
	const setFileTabView = useAppStore((s) => s.setFileTabView);
	const setFileTabContent = useAppStore((s) => s.setFileTabContent);
	const markFileTabSaved = useAppStore((s) => s.markFileTabSaved);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const tabIdRef = useRef(tab.id);

	useEffect(() => {
		if (tabIdRef.current === tab.id) return;
		tabIdRef.current = tab.id;
		setSaving(false);
		setSaveError(null);
	}, [tab.id]);

	useLiveTabContent(tab, {
		read: () =>
			getTransport().request("fs.readFile", { workspaceId: tab.workspaceId, path: tab.path }),
		applyFresh: ({ content }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, content, tick),
		keepCurrent: (tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, tab.content, tick),
	});

	const save = useCallback(async () => {
		if (!tab.dirty || saving) return;
		const content = tab.content;
		setSaving(true);
		setSaveError(null);
		try {
			await getTransport().request("fs.writeFile", {
				workspaceId: tab.workspaceId,
				path: tab.path,
				content,
			});
			markFileTabSaved(tab.workspaceId, tab.id, content);
		} catch (error) {
			setSaveError(errorText(error, "Could not save file."));
		} finally {
			setSaving(false);
		}
	}, [markFileTabSaved, saving, tab.content, tab.dirty, tab.id, tab.path, tab.workspaceId]);

	const editor = (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="file-editor-toolbar"
				data-dirty={tab.dirty === true}
				className="flex h-8 shrink-0 items-center gap-sm border-border-default border-b bg-container-header-bg px-sm"
			>
				<span
					data-testid="file-save-status"
					aria-live="polite"
					className={`min-w-0 flex-1 truncate tr-text-metadata ${saveError ? "text-feedback-error" : "text-text-muted"}`}
				>
					{saveError ?? (tab.dirty ? "Unsaved changes" : "Saved")}
				</span>
				<Button
					data-testid="file-save"
					variant="outline"
					size="sm"
					disabled={!tab.dirty || saving}
					onClick={() => void save()}
				>
					{saving ? "Saving…" : "Save"}
				</Button>
			</div>
			<div className="min-h-0 flex-1">
				<Suspense fallback={loading}>
					<MonacoEditor
						path={tab.path}
						content={tab.content}
						onChange={(value) => {
							setSaveError(null);
							setFileTabContent(tab.workspaceId, tab.id, value ?? "");
						}}
						onSave={() => void save()}
					/>
				</Suspense>
			</div>
		</div>
	);

	if (!isMarkdownPath(tab.path)) {
		return editor;
	}

	const view = tab.view ?? "rendered";
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="markdown-view-toggle"
				role="toolbar"
				aria-label="Markdown view mode"
				className="flex h-8 shrink-0 items-center justify-end gap-xs border-border-default border-b bg-container-header-bg px-sm"
			>
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
						<MarkdownPreview content={tab.content} workspaceId={tab.workspaceId} path={tab.path} />
					</Suspense>
				) : (
					editor
				)}
			</div>
		</div>
	);
}
