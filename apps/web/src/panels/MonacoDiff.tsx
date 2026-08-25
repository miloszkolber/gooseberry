import {
	type BeforeMount,
	DiffEditor,
	type DiffOnMount,
	type MonacoDiffEditor,
} from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineMewaCodeTheme,
	languageForPath,
	sharedEditorOptions,
	THEME,
	watchThemeSwap,
} from "./monacoSetup";

const beforeMount: BeforeMount = (m) => defineMewaCodeTheme(m);

export default function MonacoDiff({
	path,
	original,
	modified,
	view,
	ignoreWhitespace,
}: {
	path: string;
	original: string;
	modified: string;
	view: "split" | "inline";
	ignoreWhitespace: boolean;
}) {
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void }[]>([]);
	const editorRef = useRef<MonacoDiffEditor | null>(null);
	const modelsRef = useRef<{ dispose(): void }[]>([]);

	const onMount: DiffOnMount = (diffEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, THEME);
		editorRef.current = diffEditor;
		menuIconsRef.current = [
			decorateEditorContextMenus(diffEditor.getModifiedEditor()),
			decorateEditorContextMenus(diffEditor.getOriginalEditor()),
		];
		const model = diffEditor.getModel();
		modelsRef.current = model ? [model.original, model.modified] : [];
	};

	useEffect(
		() => () => {
			stopThemeWatchRef.current?.();
			for (const d of menuIconsRef.current) d.dispose();
			menuIconsRef.current = [];
			// Dispose the editor before its models to avoid Monaco's dispose assertion.
			editorRef.current?.dispose();
			editorRef.current = null;
			for (const model of modelsRef.current) model.dispose();
			modelsRef.current = [];
		},
		[],
	);

	return (
		<DiffEditor
			height="100%"
			original={original}
			modified={modified}
			language={languageForPath(path)}
			originalModelPath={`diff-original://${path}`}
			modifiedModelPath={`diff-modified://${path}`}
			theme={THEME}
			keepCurrentOriginalModel
			keepCurrentModifiedModel
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-text-muted">Loading diff…</div>
			}
			options={{
				...sharedEditorOptions(),
				renderSideBySide: view === "split",
				useInlineViewWhenSpaceIsLimited: false,
				hideUnchangedRegions: { enabled: true },
				ignoreTrimWhitespace: ignoreWhitespace,
			}}
		/>
	);
}
