<script lang="ts">
import Dialog from "@/components/dialog.svelte";
import { appStore, appStoreApi } from "@/store";
import { restoreSettingsFocus } from "./open-settings";
import AgentSettings from "./sections/agent-settings.svelte";
import GooseAutomationSettings from "./sections/goose-automation-settings.svelte";
import GooseSettings from "./sections/goose-settings.svelte";
import GooseToolsSettings from "./sections/goose-tools-settings.svelte";
import ModelsSettings from "./sections/models-settings.svelte";
import ProvidersSettings from "./sections/providers-settings.svelte";
import SignetSettings from "./sections/signet-settings.svelte";
import SystemSettings from "./sections/system-settings.svelte";
import { resolveSettingsSection, settingsTabs } from "./settings-dialog";
import { SettingsSection } from "./state";

let profilePending = $derived($appStore.agentProfile === null);
let genericAgent = $derived(
	!profilePending &&
		(!$appStore.agentProfile?.goose || $appStore.agentProfile.operations.administration === false),
);
let activeSection = $derived(
	resolveSettingsSection($appStore.settingsSection, $appStore.agentProfile),
);
let tabs = $derived(settingsTabs(genericAgent, profilePending));

function selectSection(section: SettingsSection): void {
	appStoreApi.getState().setSettingsSection(section);
}

function handleTabKeydown(event: KeyboardEvent): void {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	const currentTarget = event.currentTarget as HTMLButtonElement;
	const allTabs = Array.from(
		currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
	);
	const current = allTabs.indexOf(currentTarget);
	if (current < 0 || allTabs.length === 0) return;
	event.preventDefault();
	const index =
		event.key === "Home"
			? 0
			: event.key === "End"
				? allTabs.length - 1
				: (current + (event.key === "ArrowRight" ? 1 : -1) + allTabs.length) % allTabs.length;
	allTabs[index]?.focus();
	allTabs[index]?.click();
}
</script>

<Dialog
	open={$appStore.settingsOpen}
	title="Settings"
	testid="settings-dialog"
	class="settings-dialog"
	onOpenChange={(open) => {
		if (!open) appStoreApi.getState().closeSettings();
	}}
	onClosedAutoFocus={() => {
		restoreSettingsFocus();
	}}
>
	{#if $appStore.settingsOpen}
		<div
			role="tablist"
			class="flex flex-wrap gap-xs border-border-default border-b px-md py-sm sm:px-lg"
			aria-label="Settings"
		>
			{#each tabs as tab (tab.section)}
				<button
					type="button"
					role="tab"
					aria-selected={activeSection === tab.section}
					aria-controls={`settings-panel-${tab.section}`}
					tabindex={activeSection === tab.section ? 0 : -1}
					onkeydown={handleTabKeydown}
					onclick={() => selectSection(tab.section)}
					class={`shrink-0 rounded-[var(--radius-sm)] px-md py-xs tr-text-ui ${
						activeSection === tab.section
							? "bg-control-bg-selected text-text-default"
							: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
					}`}
				>
					{tab.label}
				</button>
			{/each}
		</div>
		<div
			id={`settings-panel-${activeSection}`}
			role="tabpanel"
			class="min-h-0 min-w-0 flex-1 overflow-y-auto p-md sm:p-lg"
		>
			{#if activeSection === SettingsSection.System}
				<SystemSettings />
			{:else if activeSection === SettingsSection.Agent && $appStore.agentProfile}
				<AgentSettings profile={$appStore.agentProfile} />
			{:else if activeSection === SettingsSection.Goose}
				<GooseSettings />
			{:else if activeSection === SettingsSection.Models}
				<ModelsSettings />
			{:else if activeSection === SettingsSection.Automation}
				<GooseAutomationSettings />
			{:else if activeSection === SettingsSection.Tools}
				<GooseToolsSettings />
			{:else if activeSection === SettingsSection.Signet}
				<SignetSettings />
			{:else}
				<ProvidersSettings />
			{/if}
		</div>
	{/if}
</Dialog>

<style>
	:global(dialog.settings-dialog) {
		width: calc(100vw - 1rem);
		max-width: 64rem;
		max-height: calc(100vh - 1rem);
		overflow: hidden;
	}

	:global(dialog.settings-dialog > .dialog-content) {
		display: flex;
		min-width: 0;
		max-height: calc(100vh - 1rem);
		flex-direction: column;
		padding: 0;
	}

	:global(dialog.settings-dialog > .dialog-content > .dialog-header) {
		margin: 0;
		border-bottom: var(--border-width-025) solid var(--border-default);
		padding: var(--space-400) var(--space-600);
	}

	:global(dialog.settings-dialog > .dialog-content > .dialog-body) {
		display: flex;
		min-height: 0;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		margin: 0;
	}

	@media (min-width: 640px) {
		:global(dialog.settings-dialog),
		:global(dialog.settings-dialog > .dialog-content) {
			max-height: 88vh;
		}
	}
</style>
