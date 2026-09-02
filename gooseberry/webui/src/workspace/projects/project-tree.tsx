import type { Project, SessionSummary } from "@gooseberry/contracts";
import { MessageSquare, Plus, Settings2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { errorText, getTransport } from "../../connection";
import { chatTabId, projectArea, selectActiveProjectArea, toast, useAppStore } from "../../store";
import { enterDefaultProjectArea } from "../navigation/default-project-area";
import { openChatInTab } from "../navigation/open-chat";
import { AddProjectMenu } from "./add-project-menu";
import { DirectoryPickerDialog } from "./directory-picker-dialog";
import { ProjectCustomizationDialog } from "./project-customization-dialog";
import { ProjectIcon } from "./project-icon";
import { useOpenProject } from "./use-open-project";

const EMPTY_SESSIONS: SessionSummary[] = [];

function ProjectSessions({ project }: { project: Project }) {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const catalogVersion = useAppStore(
		(state) => state.sessionCatalogVersionByProjectArea[project.id] ?? 0,
	);
	const [sessions, setSessions] = useState<SessionSummary[]>(EMPTY_SESSIONS);
	const [failed, setFailed] = useState(false);
	const navigationSequence = useRef(0);

	useEffect(() => {
		void connectionGeneration;
		void catalogVersion;
		if (status !== "connected") return;
		let cancelled = false;
		void getTransport()
			.request("session.list", { projectId: project.id, archived: false })
			.then((items) => {
				if (cancelled) return;
				setSessions(items);
				setFailed(false);
			})
			.catch(() => {
				if (!cancelled) setFailed(true);
			});
		return () => {
			cancelled = true;
		};
	}, [project.id, status, connectionGeneration, catalogVersion]);

	useEffect(
		() => () => {
			navigationSequence.current += 1;
		},
		[],
	);

	const openSession = async (sessionId: string) => {
		const sequence = ++navigationSequence.current;
		useAppStore.getState().selectProject(project.id);
		const area = await enterDefaultProjectArea(project.id);
		if (!area || sequence !== navigationSequence.current) return;
		await openChatInTab(area.id, sessionId, true);
		if (sequence !== navigationSequence.current) {
			useAppStore.getState().closeTab(chatTabId(area.id, sessionId), false, area.id);
			return;
		}
		await openChatInTab(area.id, sessionId);
	};

	return (
		<li className="flex flex-col gap-2xs">
			<div className="px-sm pt-2xs text-text-muted tr-text-eyebrow">Sessions</div>
			{sessions.map((session) => (
				<button
					key={session.sessionId}
					type="button"
					data-testid="project-session-row"
					onClick={() => void openSession(session.sessionId)}
					title={session.title}
					className="flex min-w-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-2xs text-left text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default"
				>
					<MessageSquare className="size-3 shrink-0" />
					<span className="truncate">{session.title}</span>
				</button>
			))}
			{sessions.length === 0 && !failed ? (
				<span className="px-sm text-text-muted tr-text-metadata">No sessions yet</span>
			) : null}
			{failed ? (
				<span className="px-sm text-feedback-error tr-text-metadata">Couldn't load sessions</span>
			) : null}
		</li>
	);
}

export function ProjectTree() {
	const projects = useAppStore((state) => state.projects);
	const recentProjects = useAppStore((state) => state.recentProjects);
	const selectedProjectId = useAppStore((state) => state.selectedProjectId);
	const activeRoot = useAppStore((state) => selectActiveProjectArea(state)?.root ?? null);
	const addButton = useRef<HTMLButtonElement>(null);
	const [rootPickerProject, setRootPickerProject] = useState<Project | null>(null);
	const [customizeProject, setCustomizeProject] = useState<Project | null>(null);

	const selectProject = async (project: Project) => {
		useAppStore.getState().selectProject(project.id);
		await enterDefaultProjectArea(project.id);
	};

	const { openProject, pickAndOpen, dialogs } = useOpenProject((project) => selectProject(project));

	const closeProject = (project: Project) => {
		void getTransport()
			.request("project.close", { id: project.id })
			.catch((error) => toast.error(errorText(error), `Couldn't close ${project.name}`));
	};
	const addRoot = async (project: Project, path: string) => {
		try {
			const updated = await getTransport().request("project.addRoot", { id: project.id, path });
			useAppStore.getState().applyProjectUpdated(updated);
			useAppStore
				.getState()
				.setProjectAreas(updated.id, [projectArea(updated, activeRoot ?? undefined)]);
		} catch (error) {
			toast.error(errorText(error), "Couldn't add the project root");
		}
	};
	const removeRoot = async (project: Project, path: string) => {
		try {
			const updated = await getTransport().request("project.removeRoot", { id: project.id, path });
			useAppStore.getState().applyProjectUpdated(updated);
			useAppStore
				.getState()
				.setProjectAreas(updated.id, [projectArea(updated, activeRoot ?? undefined)]);
		} catch (error) {
			toast.error(errorText(error), "Couldn't remove the project root");
		}
	};
	const selectRoot = (project: Project, root: string) => {
		const area = projectArea(project, root);
		const store = useAppStore.getState();
		store.setProjectAreas(project.id, [area]);
		store.activateProjectArea(area);
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
						<li key={project.id} className="group flex min-w-0 flex-col">
							<div className="flex w-full min-w-0 items-center">
								<button
									type="button"
									data-testid="project-row"
									data-project-id={project.id}
									data-selected={selected || undefined}
									onClick={() => void selectProject(project)}
									title={project.roots.join("\n")}
									className="flex min-w-0 flex-1 items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary data-[selected]:bg-control-bg-selected"
								>
									<ProjectIcon
										icon={project.icon ?? "folder"}
										className={`size-4 shrink-0 ${selected ? "text-primary" : "text-text-muted"}`}
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate tr-text-ui text-text-default">
											{project.name}
										</span>
										<span className="block truncate tr-text-metadata text-text-muted">
											{project.roots.length === 1
												? project.roots[0]
												: `${project.roots.length} roots`}
										</span>
									</span>
								</button>
								<button
									type="button"
									aria-label={`Customize ${project.name}`}
									title="Customize project"
									onClick={() => setCustomizeProject(project)}
									className="invisible flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default group-hover:visible focus:visible"
								>
									<Settings2 className="size-3.5" />
								</button>
								<button
									type="button"
									aria-label={`Remove ${project.name} from gooseberry`}
									title="Remove from gooseberry"
									onClick={() => closeProject(project)}
									className="invisible flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted hover:bg-control-bg-hovered hover:text-text-default group-hover:visible focus:visible"
								>
									<X className="size-3.5" />
								</button>
							</div>
							{selected ? (
								<ul className="flex w-full flex-col gap-2xs py-2xs pl-lg">
									<ProjectSessions project={project} />
									<li className="px-sm pt-xs text-text-muted tr-text-eyebrow">Roots</li>
									{project.roots.map((root) => (
										<li
											key={root}
											className="flex min-w-0 items-center gap-xs px-sm tr-text-metadata text-text-muted"
										>
											<button
												type="button"
												data-active={activeRoot === root || undefined}
												onClick={() => selectRoot(project, root)}
												className="min-w-0 flex-1 truncate text-left hover:text-text-default data-[active]:text-primary"
												title={`Use ${root} as the working directory for new chats`}
											>
												{root}
											</button>
											{project.roots.length > 1 ? (
												<button
													type="button"
													aria-label={`Remove root ${root}`}
													onClick={() => void removeRoot(project, root)}
												>
													<X className="size-3" />
												</button>
											) : null}
										</li>
									))}
									<li>
										<button
											type="button"
											onClick={() => setRootPickerProject(project)}
											className="flex items-center gap-xs px-sm py-2xs tr-text-metadata text-text-muted hover:text-text-default"
										>
											<Plus className="size-3" />
											Add root
										</button>
									</li>
								</ul>
							) : null}
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
			<DirectoryPickerDialog
				open={rootPickerProject !== null}
				onOpenChange={(open) => {
					if (!open) setRootPickerProject(null);
				}}
				onSelect={(path) => {
					const project = rootPickerProject;
					setRootPickerProject(null);
					if (project) void addRoot(project, path);
				}}
			/>
			{customizeProject ? (
				<ProjectCustomizationDialog
					project={customizeProject}
					open
					onOpenChange={(open) => {
						if (!open) setCustomizeProject(null);
					}}
				/>
			) : null}
		</nav>
	);
}
