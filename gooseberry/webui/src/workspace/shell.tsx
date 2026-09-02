import type { AgentProfile, Project } from "@gooseberry/contracts";
import { ChevronRight, LogOut, Settings } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { BrandLogo } from "../components/brand-logo";
import { Toaster } from "../components/toaster";
import { type ConnectionStatus, getTransport, logoutController } from "../connection";
import { openSettingsFrom } from "../settings/open-settings";
import {
	type ProjectArea,
	selectActiveProjectArea,
	selectContextProject,
	useAppStore,
} from "../store";
import { useGlobalHotkeys } from "./navigation/use-global-hotkeys";
import { ProjectTree } from "./projects/project-tree";
import { hasConfiguredProvider, NoProviderWelcome } from "./views/no-provider-welcome";
import { WelcomePanel } from "./views/welcome-panel";

const loadSettingsDialog = () => import("../settings/settings-dialog");
const SettingsDialog = lazy(async () => ({ default: (await loadSettingsDialog()).SettingsDialog }));
const ProjectWorkArea = lazy(async () => ({
	default: (await import("./views/project-work-area")).ProjectWorkArea,
}));

function SettingsSurface() {
	const open = useAppStore((state) => state.settingsOpen);
	return open ? (
		<Suspense fallback={null}>
			<SettingsDialog />
		</Suspense>
	) : null;
}

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

export type ShellAvailability =
	| "loading"
	| "ready"
	| "unconfigured"
	| "incompatible"
	| "disconnected"
	| "error";

export function resolveShellAvailability(
	status: ConnectionStatus,
	agentProfile: AgentProfile | null,
	providerConfigured: boolean | null,
	providerError: boolean,
): ShellAvailability {
	if (status !== "connected") return status === "disconnected" ? "disconnected" : "loading";
	if (!agentProfile) return providerError ? "error" : "loading";
	if (!agentProfile.compatible) return "incompatible";
	if (!agentProfile.operations.administration) return "ready";
	if (providerError) return "error";
	if (providerConfigured === null) return "loading";
	return providerConfigured ? "ready" : "unconfigured";
}

export function Shell() {
	const status = useAppStore((s) => s.status);
	const providerStatusGeneration = useAppStore(
		(s) => `${s.connectionGeneration}:${s.providerVersion}`,
	);
	const activeProjectAreaId = useAppStore((s) => s.activeProjectAreaId);
	const activeProjectArea = useAppStore(selectActiveProjectArea);
	const contextProject = useAppStore(selectContextProject);
	const providerConfigured = useAppStore((s) => s.providerConfigured);
	const agentProfile = useAppStore((s) => s.agentProfile);
	const authenticationEnabled = useAppStore((s) => s.authenticationEnabled);
	const [providerError, setProviderError] = useState(false);
	const [providerRefreshTick, setProviderRefreshTick] = useState(0);
	const latestProviderStatusGeneration = useRef(providerStatusGeneration);
	latestProviderStatusGeneration.current = providerStatusGeneration;

	useEffect(() => {
		void providerRefreshTick;
		const generation = providerStatusGeneration;
		if (status !== "connected") {
			useAppStore.getState().setProviderConfigured(null);
			setProviderError(false);
			return;
		}
		let current = true;
		useAppStore.getState().setProviderConfigured(null);
		setProviderError(false);
		if (!agentProfile) {
			void getTransport()
				.request("goose.status", {})
				.then((report) => {
					if (!current || generation !== latestProviderStatusGeneration.current) return;
					if (report.agentProfile) {
						useAppStore.getState().replaceAgentProfile(report.agentProfile);
					} else {
						setProviderError(true);
					}
				})
				.catch(() => {
					if (current && generation === latestProviderStatusGeneration.current) {
						setProviderError(true);
					}
				});
			return () => {
				current = false;
			};
		}
		if (!agentProfile.compatible || !agentProfile.operations.administration) return;
		void (async () => {
			try {
				const report = await getTransport().request("provider.status", {});
				if (current && generation === latestProviderStatusGeneration.current) {
					useAppStore.getState().setProviderConfigured(hasConfiguredProvider(report));
				}
			} catch {
				if (current && generation === latestProviderStatusGeneration.current) {
					useAppStore.getState().setProviderConfigured(null);
					setProviderError(true);
				}
			}
		})();
		return () => {
			current = false;
		};
	}, [agentProfile, providerStatusGeneration, providerRefreshTick, status]);

	const availability = resolveShellAvailability(
		status,
		agentProfile,
		providerConfigured,
		providerError,
	);

	const hasActiveProjectArea = availability === "ready" && activeProjectAreaId != null;
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
			availability={availability}
			onRetryProviderStatus={() => setProviderRefreshTick((tick) => tick + 1)}
			providerConfigured={providerConfigured}
			agentProfile={agentProfile}
			activeProjectAreaId={activeProjectAreaId}
			activeProjectArea={activeProjectArea}
			contextProject={contextProject}
			authenticationEnabled={authenticationEnabled}
		/>
	);
}

export function ShellLayout({
	status,
	availability,
	onRetryProviderStatus,
	providerConfigured,
	agentProfile,
	activeProjectAreaId,
	activeProjectArea,
	contextProject,
	authenticationEnabled = false,
}: {
	status: ConnectionStatus;
	availability?: ShellAvailability;
	onRetryProviderStatus?: () => void;
	providerConfigured: boolean | null;
	agentProfile?: AgentProfile | null;
	activeProjectAreaId: string | null;
	activeProjectArea: ProjectArea | null;
	contextProject: Project | null;
	authenticationEnabled?: boolean;
}) {
	const surface =
		availability ??
		(agentProfile === undefined
			? status !== "connected"
				? status === "disconnected"
					? "disconnected"
					: "loading"
				: providerConfigured === null
					? "loading"
					: providerConfigured
						? "ready"
						: "unconfigured"
			: resolveShellAvailability(status, agentProfile, providerConfigured, false));
	const hasActiveProjectArea = surface === "ready" && activeProjectAreaId !== null;
	return (
		<div data-testid="shell" className="grid h-full grid-rows-[auto_1fr]">
			<header className="flex min-w-0 items-center justify-between gap-sm border-b border-border-default bg-container-header-bg px-sm py-sm sm:px-lg">
				<div className="flex min-w-0 items-center gap-md">
					<BrandLogo />
					{surface === "ready" && contextProject ? (
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
				<div className="flex shrink-0 items-center gap-sm sm:gap-md">
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
						onMouseEnter={() => void loadSettingsDialog()}
						onFocus={() => void loadSettingsDialog()}
						onClick={(event) => openSettingsFrom(event.currentTarget)}
						className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						<Settings className="size-4" />
					</button>
					{authenticationEnabled ? (
						<button
							type="button"
							aria-label="Sign out"
							title="Sign out"
							onClick={() =>
								void logoutController().finally(() =>
									window.dispatchEvent(new Event("gooseberry-auth-lost")),
								)
							}
							className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none transition-colors hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
						>
							<LogOut className="size-4" />
						</button>
					) : null}
				</div>
				<SettingsSurface />
			</header>
			{hasActiveProjectArea && activeProjectAreaId ? (
				<div data-testid="project-shell" className="h-full min-h-0 min-w-0">
					<Suspense fallback={null}>
						<ProjectWorkArea key={activeProjectAreaId} projectAreaId={activeProjectAreaId} />
					</Suspense>
				</div>
			) : surface === "unconfigured" ? (
				<NoProviderWelcome />
			) : surface === "incompatible" ? (
				<main className="flex h-full min-h-0 min-w-0 items-center justify-center bg-container-content-bg px-xl py-xl text-center">
					<div className="flex max-w-[34rem] flex-col items-center gap-sm">
						<h1 className="tr-title-dialog text-text-default">
							{agentProfile?.name || "Connected agent"} is not compatible with Gooseberry
						</h1>
						<p role="alert" className="tr-text-ui text-text-muted">
							The agent must support the ACP session operations Gooseberry uses to list and reopen
							chats.
						</p>
						{agentProfile?.missingRequired.length ? (
							<div className="text-left tr-text-ui text-text-muted">
								<p>Missing capabilities:</p>
								<ul className="mt-xs list-disc pl-lg">
									{agentProfile.missingRequired.map((capability) => (
										<li key={capability}>
											<code>{capability}</code>
										</li>
									))}
								</ul>
							</div>
						) : null}
					</div>
				</main>
			) : surface === "disconnected" || surface === "error" ? (
				<main className="flex h-full min-h-0 min-w-0 items-center justify-center bg-container-content-bg px-xl py-xl text-center">
					<div className="flex max-w-[30rem] flex-col items-center gap-sm">
						<h1 className="tr-title-dialog text-text-default">
							{surface === "disconnected" ? "Controller disconnected" : "Agent status unavailable"}
						</h1>
						<p role="alert" className="tr-text-ui text-text-muted">
							{surface === "disconnected"
								? "Gooseberry will reconnect automatically. Your open work remains in this browser."
								: "The controller is connected, but the agent status could not be read."}
						</p>
						{surface === "error" ? (
							<div className="flex flex-wrap justify-center gap-sm">
								<button
									type="button"
									onClick={onRetryProviderStatus}
									className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
								>
									Retry
								</button>
								<button
									type="button"
									onClick={(event) => openSettingsFrom(event.currentTarget)}
									className="rounded-[var(--radius-sm)] px-md py-xs tr-text-ui text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
								>
									Open settings
								</button>
							</div>
						) : null}
					</div>
				</main>
			) : surface === "loading" ? (
				<main
					data-testid="provider-status-loading"
					className="flex h-full min-h-0 min-w-0 items-center justify-center bg-container-content-bg px-xl py-xl text-center tr-text-ui text-text-muted"
					role="status"
				>
					Checking agent status…
				</main>
			) : (
				<div
					data-testid="welcome-shell"
					className="flex h-full min-h-0 min-w-0 flex-col lg:flex-row"
				>
					<aside
						data-testid="left-nav"
						tabIndex={-1}
						className="max-h-[45%] w-full shrink-0 overflow-auto border-border-default border-b bg-container-sidebar-bg p-md outline-none lg:max-h-none lg:w-[clamp(12rem,20vw,16rem)] lg:border-r lg:border-b-0"
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
