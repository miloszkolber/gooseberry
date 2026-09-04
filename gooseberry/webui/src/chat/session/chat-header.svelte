<script lang="ts">
import type { SessionStats } from "@gooseberry/contracts";
import type { Snippet } from "svelte";
import SessionStatsBar from "./session-stats-bar.svelte";

interface Props {
	stats: SessionStats | null;
	statusEntries: [string, string][];
	left?: Snippet;
}

let { stats, statusEntries, left }: Props = $props();
</script>

<div
	data-testid="chat-toolbar"
	class="flex min-h-panel-header-row shrink-0 flex-wrap items-center gap-xs border-border-muted border-b bg-container-project-bg px-sm py-xs"
>
	<div class="flex min-w-0 flex-1 flex-wrap items-center gap-xs">{@render left?.()}</div>
	<div class="flex min-w-0 flex-wrap items-center justify-end gap-md">
		{#each statusEntries as [key, text] (key)}
			<span
				title={text}
				class="max-w-40 truncate text-text-muted tr-text-metadata sm:max-w-64"
			>
				{text}
			</span>
		{/each}
		<SessionStatsBar {stats} />
	</div>
</div>
