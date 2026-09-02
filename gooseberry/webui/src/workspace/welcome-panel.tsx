import { FolderOpen, House, type LucideIcon } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef } from "react";
import { PRODUCT_NAME } from "../constants/branding";
import { cn } from "../lib/utils";
import { useAppStore } from "../store";
import { AddProjectMenu } from "./add-project-menu";
import { enterDefaultProjectArea } from "./default-project-area";
import { useOpenProject } from "./use-open-project";

export function WelcomePanel() {
	const projects = useAppStore((s) => s.projects);
	const recentProjects = useAppStore((s) => s.recentProjects);
	const selectedProjectId = useAppStore((s) => s.selectedProjectId);
	const project = projects.find((item) => item.id === selectedProjectId) ?? projects[0] ?? null;

	const { openProject, pickAndOpen, dialogs } = useOpenProject((opened) =>
		useAppStore.getState().selectProject(opened.id, { reveal: true }),
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

			<div className="mt-xl flex flex-wrap justify-center gap-md">
				{project ? (
					<Card
						cta
						primary
						icon={House}
						title="Continue project"
						subtitle="Open the project directory and its persistent agent sessions."
						onClick={() => void enterDefaultProjectArea(project.id)}
					/>
				) : (
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
							subtitle="Choose an admitted directory. It may contain one or several repositories."
						/>
					</AddProjectMenu>
				)}
			</div>
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
					: "border-border-default bg-container-project-bg hover:border-primary-muted hover:bg-container-elevated-bg",
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
