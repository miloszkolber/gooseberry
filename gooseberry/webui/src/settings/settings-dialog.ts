import type { AgentProfile } from "@gooseberry/contracts";
import { SettingsSection } from "./state";

export interface SettingsTabDescriptor {
	section: SettingsSection;
	label: string;
}

const ADMIN_TABS: readonly SettingsTabDescriptor[] = [
	{ section: SettingsSection.Goose, label: "Goose" },
	{ section: SettingsSection.Automation, label: "Automation" },
	{ section: SettingsSection.Providers, label: "Providers" },
	{ section: SettingsSection.Models, label: "Models" },
	{ section: SettingsSection.Tools, label: "Tools" },
	{ section: SettingsSection.Signet, label: "Signet" },
	{ section: SettingsSection.System, label: "System" },
];

const GENERIC_TABS: readonly SettingsTabDescriptor[] = [
	{ section: SettingsSection.Agent, label: "Agent" },
	{ section: SettingsSection.Signet, label: "Signet" },
	{ section: SettingsSection.System, label: "System" },
];

const PENDING_TABS: readonly SettingsTabDescriptor[] = [
	{ section: SettingsSection.System, label: "System" },
];

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

export function settingsTabs(
	genericAgent = false,
	profilePending = false,
): readonly SettingsTabDescriptor[] {
	if (profilePending) return PENDING_TABS;
	return genericAgent ? GENERIC_TABS : ADMIN_TABS;
}
