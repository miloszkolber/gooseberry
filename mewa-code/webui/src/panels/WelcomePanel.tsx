import type { Workspace } from "@mewa-code/contracts";
import { FolderOpen, House, type LucideIcon, Rocket } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PRODUCT_NAME } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { AddProjectMenu } from "./AddProjectMenu";
import { enterDefaultWorkspace } from "./defaultWorkspace";
import { NewWorkspaceDialog } from "./NewWorkspaceDialog";
import { ProjectSkillsNotice } from "./ProjectSkillsNotice";
import { ProviderWarningBanner } from "./ProviderWarningBanner";
import { useOpenProject } from "./useOpenProject";

export function WelcomePanel() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const [dialog, setDialog] = useState<{
		projectId: string;
		prompt: string;
		target?: "worktree" | "default";
	} | null>(null);

	const project = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

	const { openProject, pickAndOpen, dialogs } = useOpenProject((opened) =>
		useAppStore.getState().selectProject(opened.id, { reveal: true }),
	);

	const onWorkspaceCreated = async (ws: Workspace) => {
		useAppStore
			.getState()
			.setWorkspaces(
				ws.projectId,
				await getTransport().request("workspace.list", { projectId: ws.projectId }),
			);
	};

	const noProjects = project == null;

	const projectFolderCard = (projectId: string) => (
		<Card
			cta
			primary
			icon={House}
			title="Work in project folder"
			subtitle="Chats and changes run directly in your project folder — no isolation."
			onClick={() => void enterDefaultWorkspace(projectId)}
		/>
	);

	const isolatedWorktreeCard = (projectId: string) => (
		<Card
			icon={Rocket}
			title="Start in isolated worktree"
			subtitle="Create a separate checkout and branch when you need isolated changes."
			onClick={() => setDialog({ projectId, prompt: "", target: "worktree" })}
		/>
	);

	const openProjectCard = () => (
		<AddProjectMenu
			recentProjects={recentProjects}
			onOpen={() => void pickAndOpen()}
			onOpenRecent={(path) => void openProject(path)}
			align="start"
		>
			<Card
				cta
				primary
				icon={FolderOpen}
				title="Open project"
				subtitle="Choose a local git repository to work in."
			/>
		</AddProjectMenu>
	);

	return (
		<div
			data-testid="welcome"
			className="flex h-full min-h-0 flex-col items-center justify-center overflow-auto px-xl py-xl text-center"
		>
			<h1
				data-testid="welcome-title"
				className="tr-brand-hero max-w-[640px] break-words text-primary"
			>
				{project ? project.name : PRODUCT_NAME}
			</h1>

			<ProviderWarningBanner />
			{project ? <ProjectSkillsNotice projectId={project.id} /> : null}

			<div className="mt-xl flex flex-wrap justify-center gap-md">
				{noProjects ? (
					openProjectCard()
				) : (
					<>
						{projectFolderCard(project.id)}
						{isolatedWorktreeCard(project.id)}
					</>
				)}
			</div>

			{dialog ? (
				<NewWorkspaceDialog
					open
					projectId={dialog.projectId}
					initialPrompt={dialog.prompt}
					{...(dialog.target ? { initialTarget: dialog.target } : {})}
					onOpenChange={(o) => {
						if (!o) setDialog(null);
					}}
					onCreated={(ws) => void onWorkspaceCreated(ws)}
				/>
			) : null}
			{dialogs}
		</div>
	);
}

type CardProps = {
	cta?: boolean;
	primary?: boolean;
	icon: LucideIcon;
	title: string;
	subtitle: string;
	tag?: string;
} & ComponentPropsWithoutRef<"button">;

const Card = forwardRef<HTMLButtonElement, CardProps>(function Card(
	{ cta, primary, icon: Icon, title, subtitle, tag, className, ...rest },
	ref,
) {
	return (
		<button
			ref={ref}
			type="button"
			data-testid={cta ? "welcome-cta" : "welcome-action"}
			{...rest}
			className={cn(
				"relative flex h-[150px] w-[220px] flex-col items-start justify-between rounded-[var(--radius-sm)] border bg-clip-padding p-lg text-left transition-colors",
				primary
					? "border-primary-muted bg-primary-subtle hover:bg-primary-soft"
					: "border-border-default bg-container-workspace-bg hover:border-primary-muted hover:bg-container-elevated-bg",
				className,
			)}
		>
			{tag ? (
				<span className="absolute top-md right-md rounded-full border border-primary-muted bg-clip-padding bg-primary-subtle px-sm py-0.5 tr-text-label-pill text-primary">
					{tag}
				</span>
			) : null}
			<span
				className={cn(
					"flex size-9 items-center justify-center rounded-[var(--radius-sm)]",
					primary ? "bg-primary text-text-on-primary" : "bg-control-bg-selected text-text-muted",
				)}
			>
				<Icon className="size-4" />
			</span>
			<span className="w-full">
				<span className="block tr-title-card text-text-default">{title}</span>
				<span className="mt-0.5 block text-text-muted tr-text-metadata leading-snug">
					{subtitle}
				</span>
			</span>
		</button>
	);
});
