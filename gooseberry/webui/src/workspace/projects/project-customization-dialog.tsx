import {
	normalizeProjectName,
	PROJECT_ICONS,
	PROJECT_NAME_MAX_LENGTH,
	type Project,
	type ProjectIcon as ProjectIconName,
} from "@gooseberry/contracts";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import { errorText, getTransport } from "../../connection";
import { toast, useAppStore } from "../../store";
import { ProjectIcon } from "./project-icon";

const ICON_LABELS: Record<ProjectIconName, string> = {
	folder: "Folder",
	code: "Code",
	book: "Book",
	flask: "Experiment",
	rocket: "Rocket",
	sparkles: "Sparkles",
};

export function ProjectCustomizationDialog({
	project,
	open,
	onOpenChange,
}: {
	project: Project;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [name, setName] = useState(project.name);
	const [icon, setIcon] = useState<ProjectIconName>(project.icon ?? "folder");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setName(project.name);
		setIcon(project.icon ?? "folder");
		setError(null);
	}, [open, project.name, project.icon]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		let normalized: string;
		try {
			normalized = normalizeProjectName(name);
		} catch (cause) {
			setError(errorText(cause));
			return;
		}
		setBusy(true);
		setError(null);
		void getTransport()
			.request("project.update", { id: project.id, name: normalized, icon })
			.then((updated) => {
				useAppStore.getState().applyProjectUpdated(updated);
				onOpenChange(false);
			})
			.catch((cause) => {
				setError(errorText(cause));
				toast.error(errorText(cause), "Couldn't update the project");
			})
			.finally(() => setBusy(false));
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
			<DialogContent data-testid="project-customization-dialog" className="max-w-[26rem]">
				<form className="flex flex-col gap-lg" onSubmit={submit}>
					<DialogHeader>
						<DialogTitle>Customize project</DialogTitle>
						<DialogDescription>Choose the name and icon shown in Gooseberry.</DialogDescription>
					</DialogHeader>
					<label className="flex flex-col gap-xs tr-text-ui text-text-default">
						<span>Name</span>
						<input
							autoFocus
							value={name}
							maxLength={PROJECT_NAME_MAX_LENGTH}
							disabled={busy}
							onChange={(event) => setName(event.target.value)}
							className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
						/>
					</label>
					<fieldset className="flex flex-col gap-xs" disabled={busy}>
						<legend className="mb-xs tr-text-ui text-text-default">Icon</legend>
						<div className="grid grid-cols-3 gap-xs">
							{PROJECT_ICONS.map((candidate) => (
								<label
									key={candidate}
									data-selected={candidate === icon || undefined}
									className="flex cursor-pointer items-center gap-xs rounded-[var(--radius-sm)] border border-border-default px-sm py-xs text-text-muted tr-text-metadata hover:bg-control-bg-hovered focus-within:ring-2 focus-within:ring-primary data-[selected]:border-primary data-[selected]:bg-primary-subtle data-[selected]:text-text-default"
								>
									<input
										type="radio"
										name="project-icon"
										value={candidate}
										checked={candidate === icon}
										onChange={() => setIcon(candidate)}
										className="sr-only"
									/>
									<ProjectIcon icon={candidate} className="size-3.5" />
									{ICON_LABELS[candidate]}
								</label>
							))}
						</div>
					</fieldset>
					{error ? (
						<p role="alert" className="text-feedback-error tr-text-metadata">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={busy || !name.trim()}
							data-testid="project-customization-save"
						>
							{busy ? "Saving…" : "Save"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
