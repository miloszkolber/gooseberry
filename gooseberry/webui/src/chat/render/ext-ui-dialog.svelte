<script lang="ts">
import { untrack } from "svelte";
import Button from "../../components/button.svelte";
import Dialog from "../../components/dialog.svelte";
import type { ExtUiDialogRequest } from "../runtime/types";

interface Props {
	request: ExtUiDialogRequest;
	onReply: (value: string | boolean | null) => void;
}

let { request, onReply }: Props = $props();
let open = $state(true);
let text = $state(untrack(() => (request.kind === "editor" ? (request.prefill ?? "") : "")));
const cancel = () => onReply(request.kind === "confirm" ? false : null);
</script>

<Dialog
	bind:open
	title={request.title}
	description={request.kind === "confirm" ? request.message : undefined}
	onOpenChange={(next) => {
		if (!next) cancel();
	}}
>
	<div data-testid="ext-ui-dialog" data-kind={request.kind} class="flex flex-col gap-md">
		{#if request.kind === "select"}
			<div class="flex flex-col gap-xs">
				{#each request.options as option (option)}
					<button
						type="button"
						data-testid="ext-ui-option"
						onclick={() => onReply(option)}
						class="rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-md py-sm text-left tr-text-ui text-text-default outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
					>{option}</button>
				{/each}
			</div>
		{:else if request.kind === "input"}
			<!-- svelte-ignore a11y_autofocus (This modal request must move focus to its only answer field.) -->
			<input
				data-testid="ext-ui-input"
				autofocus
				bind:value={text}
				placeholder={request.placeholder ?? ""}
				onkeydown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						onReply(text);
					}
				}}
				class="rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active"
			/>
		{:else if request.kind === "editor"}
			<!-- svelte-ignore a11y_autofocus (This modal request must move focus to its only answer field.) -->
			<textarea
				data-testid="ext-ui-editor"
				autofocus
				bind:value={text}
				rows={8}
				class="resize-none rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-sm py-xs tr-code-text text-text-default outline-none focus-visible:border-control-border-active"
			></textarea>
		{/if}
	</div>

	{#snippet actions()}
		{#if request.kind === "confirm"}
			<Button variant="outline" data-testid="ext-ui-cancel" onclick={() => onReply(false)}>Cancel</Button>
			<Button data-testid="ext-ui-confirm" onclick={() => onReply(true)}>OK</Button>
		{:else if request.kind === "input" || request.kind === "editor"}
			<Button variant="outline" data-testid="ext-ui-cancel" onclick={cancel}>Cancel</Button>
			<Button data-testid="ext-ui-submit" onclick={() => onReply(text)}>Submit</Button>
		{:else}
			<Button variant="outline" data-testid="ext-ui-cancel" onclick={cancel}>Cancel</Button>
		{/if}
	{/snippet}
</Dialog>
