import type { Project } from "@gooseberry/contracts";
import { type ReactNode, useState } from "react";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { DirectoryPickerDialog } from "./directory-picker-dialog";
import { NoticeDialog } from "./notice-dialog";

export function useOpenProject(onOpened: (project: Project) => void | Promise<void>): {
	openProject: (rawPath: string) => Promise<void>;
	pickAndOpen: () => Promise<void>;
	dialogs: ReactNode;
} {
	const [openError, setOpenError] = useState<string | null>(null);
	const [pickerOpen, setPickerOpen] = useState(false);

	const adopt = async (project: Project) => {
		useAppStore.getState().applyProjectUpdated(project);
		await onOpened(project);
	};

	const openProject = async (rawPath: string) => {
		const trimmed = rawPath.trim();
		if (!trimmed) return;
		try {
			await adopt(await getTransport().request("project.open", { path: trimmed }));
		} catch (err) {
			setOpenError(errorText(err, `Couldn't open ${trimmed}.`));
		}
	};

	const pickAndOpen = async () => setPickerOpen(true);

	const dialogs = (
		<>
			<DirectoryPickerDialog
				open={pickerOpen}
				onOpenChange={setPickerOpen}
				onSelect={(path) => {
					setPickerOpen(false);
					void openProject(path);
				}}
			/>
			<NoticeDialog
				open={openError !== null}
				onOpenChange={(o) => {
					if (!o) setOpenError(null);
				}}
				title="Couldn't open project"
				description={<span className="whitespace-pre-line">{openError}</span>}
				testId="open-error-dialog"
			/>
		</>
	);

	return { openProject, pickAndOpen, dialogs };
}
