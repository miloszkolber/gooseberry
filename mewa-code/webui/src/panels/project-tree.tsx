import type { Project } from "@mewa-code/contracts";
import { Folder, FolderOpen, Plus, X } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";
import { AddProjectMenu } from "./add-project-menu";
import { enterDefaultWorkspace } from "./default-workspace";
import { useOpenProject } from "./use-open-project";

export function ProjectTree() {
	const projects = useAppStore((state) => state.projects);
	const recentProjects = useAppStore((state) => state.recentProjects);
	const selectedProjectId = useAppStore((state) => state.selectedProjectId);
	const addButton = useRef<HTMLButtonElement>(null);

	const selectProject = async (project: Project) => {
		useAppStore.getState().selectProject(project.id);
		await enterDefaultWorkspace(project.id);
	};

	const { openProject, pickAndOpen, dialogs } = useOpenProject((project) => selectProject(project));

	const closeProject = (project: Project) => {
		void getTransport()
			.request("project.close", { id: project.id })
			.catch((error) => toast.error(errorText(error), `Couldn't close ${project.name}`));
	};

	return (
		<nav className="flex flex-col gap-sm">
			<header className="flex h-7 items-center justify-between pr-xs pl-sm">
				<span className="tr-text-eyebrow text-text-muted">Projects</span>
				<AddProjectMenu
					recentProjects={recentProjects}
					onOpen={() => void pickAndOpen()}
					onOpenRecent={(path) => void openProject(path)}
				>
					<Button
						ref={addButton}
						variant="ghost"
						size="icon"
						data-testid="add-project-menu"
						aria-label="Add project"
					>
						<Plus className="size-4" />
					</Button>
				</AddProjectMenu>
			</header>

			<ul className="flex flex-col gap-2xs">
				{projects.map((project) => {
					const selected = selectedProjectId === project.id;
					return (
						<li key={project.id} className="group flex min-w-0 items-center">
							<button
								type="button"
								data-testid="project-row"
								data-project-id={project.id}
								data-selected={selected || undefined}
								onClick={() => void selectProject(project)}
								title={project.path}
								className="flex min-w-0 flex-1 items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[selected]:bg-control-bg-selected"
							>
								{selected ? (
									<FolderOpen className="size-4 shrink-0 text-primary" />
								) : (
									<Folder className="size-4 shrink-0 text-text-muted" />
								)}
								<span className="min-w-0 flex-1">
									<span className="block truncate tr-text-ui text-text-default">
										{project.name}
									</span>
									<span className="block truncate tr-text-metadata text-text-muted">
										{project.path}
									</span>
								</span>
							</button>
							<button
								type="button"
								aria-label={`Remove ${project.name} from Mewa`}
								title="Remove from Mewa"
								onClick={() => closeProject(project)}
								className="invisible flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default group-hover:visible focus:visible"
							>
								<X className="size-3.5" />
							</button>
						</li>
					);
				})}
			</ul>
			{projects.length === 0 ? (
				<p className="px-sm py-xs tr-text-metadata text-text-muted">
					Open a directory to start a project.
				</p>
			) : null}
			{dialogs}
		</nav>
	);
}
