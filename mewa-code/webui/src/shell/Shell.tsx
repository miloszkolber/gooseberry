import { ChevronRight, GitBranch, Settings } from "lucide-react";
import { ProjectTree } from "../panels/ProjectTree";
import { SettingsDialog } from "../panels/SettingsDialog";
import { Toaster } from "../panels/Toaster";
import { WelcomePanel } from "../panels/WelcomePanel";
import {
	isUserOwnedWorkspace,
	selectActiveWorkspace,
	selectContextProject,
	useAppStore,
} from "../store";
import type { ConnectionStatus } from "../transport";
import { BrandLogo } from "./BrandLogo";
import { useGlobalHotkeys } from "./useGlobalHotkeys";
import { WorkspaceWorkbench } from "./WorkspaceWorkbench";

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	connected: "Connected",
	connecting: "Connecting…",
	disconnected: "Disconnected",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
	connected: "bg-feedback-success",
	connecting: "bg-feedback-warning",
	disconnected: "bg-feedback-error",
};

export function Shell() {
	const status = useAppStore((s) => s.status);
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const hasActiveWorkspace = activeWorkspaceId != null;
	useGlobalHotkeys({
		onProjects: () => {
			(document.querySelector('[data-testid="left-nav"]') as HTMLElement | null)?.focus();
		},
		...(hasActiveWorkspace
			? {
					onWorkspace: () => {
						(
							document.querySelector('[data-testid="activity-tabs"]') as HTMLElement | null
						)?.focus();
					},
				}
			: {}),
	});

	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border-default bg-container-header-bg px-lg py-sm">
				<div className="flex min-w-0 items-center gap-md">
					<BrandLogo />
					{contextProject ? (
						<div
							data-testid="scope-context"
							data-context={activeWorkspace ? "workspace" : "project-home"}
							className="flex min-w-0 items-center gap-xs leading-tight tr-text-ui"
						>
							<span className="hidden min-w-0 items-center gap-xs sm:flex">
								<span
									data-testid="scope-project"
									className="max-w-[160px] truncate text-text-default"
								>
									{contextProject.name}
								</span>
								<ChevronRight className="size-3 shrink-0 text-text-muted" />
							</span>
							<span data-testid="scope-name" className="max-w-[220px] truncate text-text-default">
								{activeWorkspace?.name ?? "Project home"}
							</span>
							{activeWorkspace ? (
								<>
									<GitBranch className="size-3 shrink-0 text-text-muted" />
									<span data-testid="scope-branch" className="truncate text-text-muted">
										{activeWorkspace.branch}
									</span>
									{isUserOwnedWorkspace(activeWorkspace) ? null : (
										<span
											data-testid="scope-base"
											className="hidden shrink-0 text-text-muted md:inline"
										>
											· from {activeWorkspace.baseBranch}
										</span>
									)}
								</>
							) : null}
						</div>
					) : null}
				</div>
				<div className="flex shrink-0 items-center gap-md">
					<span
						data-testid="connection-status"
						data-status={status}
						role="status"
						aria-label={STATUS_LABEL[status]}
						className="inline-flex items-center gap-sm tr-text-ui text-text-muted"
					>
						<span aria-hidden="true" className={`size-2 rounded-full ${STATUS_DOT[status]}`} />
						<span aria-hidden="true" className="hidden sm:inline">
							{STATUS_LABEL[status]}
						</span>
					</span>
					<button
						type="button"
						data-testid="open-settings"
						aria-label="Settings"
						title="Settings"
						onClick={() => useAppStore.getState().openSettings()}
						className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						<Settings className="size-4" />
					</button>
				</div>
				<SettingsDialog />
			</header>
			{hasActiveWorkspace && activeWorkspaceId ? (
				<div data-testid="workspace-shell" className="h-full min-h-0 min-w-0">
					<WorkspaceWorkbench key={activeWorkspaceId} workspaceId={activeWorkspaceId} />
				</div>
			) : (
				<div data-testid="welcome-shell" className="flex h-full min-h-0 min-w-0">
					<aside
						data-testid="left-nav"
						tabIndex={-1}
						className="w-[clamp(12rem,20vw,16rem)] shrink-0 overflow-auto border-border-default border-r bg-container-sidebar-bg p-md outline-none"
					>
						<ProjectTree />
					</aside>
					<main className="min-h-0 min-w-0 flex-1 bg-container-content-bg">
						<WelcomePanel />
					</main>
				</div>
			)}
			<Toaster />
		</div>
	);
}
