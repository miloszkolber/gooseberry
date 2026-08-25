import type { Project } from "@mewa-code/contracts";
import { type ReactNode, useState } from "react";
import { useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { NoticeDialog } from "./notice-dialog";

const PICK_TIMEOUT_MS = 30 * 60_000;

export function useOpenProject(onOpened: (project: Project) => void | Promise<void>): {
	openProject: (rawPath: string) => Promise<void>;
	pickAndOpen: () => Promise<void>;
	dialogs: ReactNode;
} {
	const [openError, setOpenError] = useState<string | null>(null);

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

	const pickAndOpen = async () => {
		let path: string | null;
		try {
			({ path } = await getTransport().request(
				"dialog.selectDirectory",
				{},
				{ timeoutMs: PICK_TIMEOUT_MS },
			));
		} catch (err) {
			setOpenError(errorText(err, "Couldn't open the folder picker on the host."));
			return;
		}
		if (path) await openProject(path);
	};

	const dialogs = (
		<>
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
