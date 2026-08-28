import type { Project } from "@gooseberry/contracts";
import { ChevronRight, Settings } from "lucide-react";
import { useEffect, useRef } from "react";
import { hasConfiguredProvider, NoProviderWelcome } from "../panels/no-provider-welcome";
import { ProjectTree } from "../panels/project-tree";
import { SettingsDialog } from "../panels/settings-dialog";
import { Toaster } from "../panels/toaster";
import { WelcomePanel } from "../panels/welcome-panel";
import {
	type ProjectArea,
	selectActiveProjectArea,
	selectContextProject,
	useAppStore,
} from "../store";
import { type ConnectionStatus, getTransport } from "../transport";
import { BrandLogo } from "./brand-logo";
import { ProjectWorkArea } from "./project-work-area";
import { useGlobalHotkeys } from "./use-global-hotkeys";

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
	const providerStatusGeneration = useAppStore(
		(s) => `${s.connectionGeneration}:${s.providerVersion}`,
	);
	const activeProjectAreaId = useAppStore((s) => s.activeProjectAreaId);
	const activeProjectArea = useAppStore(selectActiveProjectArea);
	const contextProject = useAppStore(selectContextProject);
	const providerConfigured = useAppStore((s) => s.providerConfigured);
	const latestProviderStatusGeneration = useRef(providerStatusGeneration);
	latestProviderStatusGeneration.current = providerStatusGeneration;

	useEffect(() => {
		const generation = providerStatusGeneration;
		if (status !== "connected") {
			useAppStore.getState().setProviderConfigured(null);
			return;
		}
		let current = true;
		useAppStore.getState().setProviderConfigured(null);
		void (async () => {
			try {
				const report = await getTransport().request("provider.status", {});
				if (current && generation === latestProviderStatusGeneration.current) {
					useAppStore.getState().setProviderConfigured(hasConfiguredProvider(report));
				}
			} catch {
				if (current && generation === latestProviderStatusGeneration.current) {
					useAppStore.getState().setProviderConfigured(null);
				}
			}
		})();
		return () => {
			current = false;
		};
	}, [providerStatusGeneration, status]);

	const hasActiveProjectArea = providerConfigured === true && activeProjectAreaId != null;
	useGlobalHotkeys({
		onProjects: () => {
			(document.querySelector('[data-testid="left-nav"]') as HTMLElement | null)?.focus();
		},
		...(hasActiveProjectArea
			? {
					onProjectArea: () => {
						(
							document.querySelector('[data-testid="activity-tabs"]') as HTMLElement | null
						)?.focus();
					},
				}
			: {}),
	});

	return (
		<ShellLayout
			status={status}
			providerConfigured={providerConfigured}
			activeProjectAreaId={activeProjectAreaId}
			activeProjectArea={activeProjectArea}
			contextProject={contextProject}
		/>
	);
}

export function ShellLayout({
	status,
	providerConfigured,
	activeProjectAreaId,
	activeProjectArea,
	contextProject,
}: {
	status: ConnectionStatus;
	providerConfigured: boolean | null;
	activeProjectAreaId: string | null;
	activeProjectArea: ProjectArea | null;
	contextProject: Project | null;
}) {
	const hasActiveProjectArea = providerConfigured === true && activeProjectAreaId !== null;
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex items-center justify-between border-b border-border-default bg-container-header-bg px-lg py-sm">
				<div className="flex min-w-0 items-center gap-md">
					<BrandLogo />
					{providerConfigured === true && contextProject ? (
						<div
							data-testid="scope-context"
							data-context={activeProjectArea ? "project" : "project-home"}
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
								{activeProjectArea?.name ?? "Project home"}
							</span>
							{activeProjectArea ? (
								<span className="max-w-[260px] truncate text-text-muted">
									{activeProjectArea.root}
								</span>
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
			{hasActiveProjectArea && activeProjectAreaId ? (
				<div data-testid="project-shell" className="h-full min-h-0 min-w-0">
					<ProjectWorkArea key={activeProjectAreaId} projectAreaId={activeProjectAreaId} />
				</div>
			) : providerConfigured === false ? (
				<NoProviderWelcome />
			) : providerConfigured === null ? (
				<main
					data-testid="provider-status-loading"
					className="flex h-full min-h-0 min-w-0 items-center justify-center bg-container-content-bg px-xl py-xl text-center tr-text-ui text-text-muted"
					role="status"
				>
					Checking provider status…
				</main>
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
