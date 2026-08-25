import MonacoReact, { type BeforeMount, type OnChange, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineMewaCodeTheme,
	EDITOR_THEME,
	sharedEditorOptions,
	watchThemeSwap,
} from "./monacoSetup";

const beforeMount: BeforeMount = (m) => defineMewaCodeTheme(m);

export default function MonacoEditor({
	path,
	content,
	onChange,
	onSave,
}: {
	path: string;
	content: string;
	onChange: OnChange;
	onSave: () => void;
}) {
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void } | null>(null);
	const saveActionRef = useRef<{ dispose(): void } | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const onSaveRef = useRef(onSave);
	onSaveRef.current = onSave;

	const onMount: OnMount = (codeEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, EDITOR_THEME);
		editorRef.current = codeEditor;
		menuIconsRef.current = decorateEditorContextMenus(codeEditor);
		saveActionRef.current = codeEditor.addAction({
			id: "mewa-code.save-file",
			label: "Save file",
			keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyS],
			run: () => onSaveRef.current(),
		});
	};

	useEffect(
		() => () => {
			stopThemeWatchRef.current?.();
			menuIconsRef.current?.dispose();
			saveActionRef.current?.dispose();
		},
		[],
	);

	return (
		<MonacoReact
			height="100%"
			path={path}
			value={content}
			onChange={onChange}
			theme={EDITOR_THEME}
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-text-muted">
					Loading editor…
				</div>
			}
			options={{ ...sharedEditorOptions(), readOnly: false }}
		/>
	);
}
