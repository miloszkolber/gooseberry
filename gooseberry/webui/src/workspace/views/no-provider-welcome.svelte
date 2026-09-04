<script lang="ts">
import Button from "../../components/button.svelte";
import { openSettingsFrom } from "../../settings/open-settings";
import { SettingsSection } from "../../store";
</script>

<main
	data-testid="no-provider-welcome"
	class="app-content flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-md px-xl py-xl text-center"
>
	<h1 class="tr-brand-hero text-primary">Goose unavailable</h1>
	<p class="max-w-[34rem] tr-text-reading text-text-muted">
		Start Goose ACP and configure a provider in Goose, then refresh this page.
	</p>
	<Button
		data-testid="connect-provider"
		onclick={(event) => openSettingsFrom(event.currentTarget, SettingsSection.Providers)}
	>
		View Goose providers
	</Button>
</main>
