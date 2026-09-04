<script lang="ts">
import type { Snippet } from "svelte";
import Button from "./button.svelte";
import Dialog from "./dialog.svelte";
import Icon from "./icon.svelte";

interface Props {
	open?: boolean;
	title: string;
	description?: string | undefined;
	descriptionContent?: Snippet;
	confirmLabel?: string;
	cancelLabel?: string;
	destructive?: boolean;
	confirmTestId?: string;
	onConfirm: () => void | Promise<void>;
	onOpenChange?: ((open: boolean) => void) | undefined;
	onClosedAutoFocus?: (() => void) | undefined;
}

let {
	open = $bindable(false),
	title,
	description,
	descriptionContent,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	destructive = false,
	confirmTestId,
	onConfirm,
	onOpenChange,
	onClosedAutoFocus,
}: Props = $props();

function setOpen(next: boolean): void {
	open = next;
	onOpenChange?.(next);
}

async function confirm(): Promise<void> {
	await onConfirm();
	setOpen(false);
}
</script>

<Dialog
	bind:open
	role="alertdialog"
	{title}
	{description}
	hideClose
	testid="confirm-dialog"
	class="max-w-[24rem]"
	{onClosedAutoFocus}
	onOpenChange={setOpen}
>
	{#if descriptionContent}
		<div class="dialog-description">{@render descriptionContent()}</div>
	{/if}
	{#snippet actions()}
		<Button variant="outline" onclick={() => setOpen(false)}>{cancelLabel}</Button>
		<Button
			variant={destructive ? "destructive" : "default"}
			data-testid={confirmTestId}
			onclick={confirm}
		>
			{#if destructive}<Icon name="triangle-alert" size={16} />{/if}
			{confirmLabel}
		</Button>
	{/snippet}
</Dialog>
