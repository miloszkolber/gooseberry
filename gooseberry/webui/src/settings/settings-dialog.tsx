import type { AgentProfile } from "@gooseberry/contracts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/store";
import { restoreSettingsFocus } from "./open-settings";
import { AgentSettings } from "./sections/agent-settings";
import { GooseAutomationSettings } from "./sections/goose-automation-settings";
import { GooseSettings } from "./sections/goose-settings";
import { GooseToolsSettings } from "./sections/goose-tools-settings";
import { ModelsSettings } from "./sections/models-settings";
import { ProvidersSettings } from "./sections/providers-settings";
import { SignetSettings } from "./sections/signet-settings";
import { SystemSettings } from "./sections/system-settings";
import { SettingsSection } from "./state";

export function resolveSettingsSection(
	section: SettingsSection,
	profile: AgentProfile | null,
): SettingsSection {
	if (profile === null) return SettingsSection.System;
	if (!profile.goose || !profile.operations.administration) {
		return section === SettingsSection.Signet || section === SettingsSection.System
			? section
			: SettingsSection.Agent;
	}
	return section === SettingsSection.Agent ? SettingsSection.Providers : section;
}

export function SettingsDialog() {
	const open = useAppStore((state) => state.settingsOpen);
	const section = useAppStore((state) => state.settingsSection);
	const agentProfile = useAppStore((state) => state.agentProfile);
	const profilePending = agentProfile === null;
	const genericAgent =
		!profilePending && (!agentProfile.goose || agentProfile.operations.administration === false);
	const activeSection = resolveSettingsSection(section, agentProfile);
	return (
		<Dialog open={open} onOpenChange={(next) => !next && useAppStore.getState().closeSettings()}>
			<DialogContent
				data-testid="settings-dialog"
				onCloseAutoFocus={(event) => {
					if (!restoreSettingsFocus()) return;
					event.preventDefault();
				}}
				className="flex max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-[64rem] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-h-[88vh]"
			>
				<DialogHeader className="border-border-default border-b px-lg py-md">
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>
				<SettingsNavigation
					section={activeSection}
					genericAgent={genericAgent}
					profilePending={profilePending}
				/>
				<div
					id={`settings-panel-${activeSection}`}
					role="tabpanel"
					className="min-h-0 min-w-0 flex-1 overflow-y-auto p-md sm:p-lg"
				>
					{activeSection === SettingsSection.System ? (
						<SystemSettings />
					) : activeSection === SettingsSection.Agent && agentProfile ? (
						<AgentSettings profile={agentProfile} />
					) : activeSection === SettingsSection.Goose ? (
						<GooseSettings />
					) : activeSection === SettingsSection.Models ? (
						<ModelsSettings />
					) : activeSection === SettingsSection.Automation ? (
						<GooseAutomationSettings />
					) : activeSection === SettingsSection.Tools ? (
						<GooseToolsSettings />
					) : activeSection === SettingsSection.Signet ? (
						<SignetSettings />
					) : (
						<ProvidersSettings />
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function SettingsNavigation({
	section,
	genericAgent = false,
	profilePending = false,
}: {
	section: SettingsSection;
	genericAgent?: boolean;
	profilePending?: boolean;
}) {
	return (
		<div
			role="tablist"
			className="flex gap-xs overflow-x-auto whitespace-nowrap border-border-default border-b px-md py-sm sm:px-lg"
			aria-label="Settings"
		>
			{profilePending ? null : genericAgent ? (
				<SettingsTab
					active={section === SettingsSection.Agent}
					onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Agent)}
				>
					Agent
				</SettingsTab>
			) : (
				<>
					<SettingsTab
						active={section === SettingsSection.Goose}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Goose)}
					>
						Goose
					</SettingsTab>
					<SettingsTab
						active={section === SettingsSection.Automation}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Automation)}
					>
						Automation
					</SettingsTab>
					<SettingsTab
						active={section === SettingsSection.Providers}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Providers)}
					>
						Providers
					</SettingsTab>
					<SettingsTab
						active={section === SettingsSection.Models}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Models)}
					>
						Models
					</SettingsTab>
					<SettingsTab
						active={section === SettingsSection.Tools}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Tools)}
					>
						Tools
					</SettingsTab>
				</>
			)}
			{profilePending ? null : (
				<SettingsTab
					active={section === SettingsSection.Signet}
					onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Signet)}
				>
					Signet
				</SettingsTab>
			)}
			<SettingsTab
				active={section === SettingsSection.System}
				onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.System)}
			>
				System
			</SettingsTab>
		</div>
	);
}

function SettingsTab({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			aria-controls={`settings-panel-${children.toLowerCase()}`}
			tabIndex={active ? 0 : -1}
			onKeyDown={(event) => {
				if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
				const tabs = Array.from(
					event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
						[],
				);
				const current = tabs.indexOf(event.currentTarget);
				if (current < 0 || tabs.length === 0) return;
				event.preventDefault();
				const index =
					event.key === "Home"
						? 0
						: event.key === "End"
							? tabs.length - 1
							: (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
				tabs[index]?.focus();
				tabs[index]?.click();
			}}
			onClick={onClick}
			className={`shrink-0 rounded-[var(--radius-sm)] px-md py-xs tr-text-ui ${
				active
					? "bg-control-bg-selected text-text-default"
					: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			}`}
		>
			{children}
		</button>
	);
}
