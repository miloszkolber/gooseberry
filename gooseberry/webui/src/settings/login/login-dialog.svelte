<script lang="ts">
import Button from "@/components/button.svelte";
import Dialog from "@/components/dialog.svelte";
import Icon from "@/components/icon.svelte";
import type { LoginState } from "./login-state";

interface Props {
	state: LoginState;
	providerName: string;
	onReply: (value: string) => void;
	onCancel: () => void;
	onClose: () => void;
}

let { state: loginState, providerName, onReply, onCancel, onClose }: Props = $props();
let prompt = $state<HTMLInputElement>();
let openedUrl = $state<string | null>(null);
let open = $state(true);
let terminal = $derived(loginState.status !== "active");
let title = $derived(
	loginState.status === "success"
		? `${providerName} connected`
		: loginState.status === "error"
			? "Couldn't connect"
			: `Connect ${providerName}`,
);
let description = $derived<string>(
	loginState.instructions && loginState.status === "active" ? loginState.instructions : "",
);

$effect(() => {
	const deviceUri = loginState.deviceCode?.verificationUri;
	if (!deviceUri || openedUrl === deviceUri) return;
	openedUrl = deviceUri;
	window.open(deviceUri, "_blank", "noopener,noreferrer");
});

$effect(() => {
	const input = prompt;
	if (!input || loginState.input?.kind !== "prompt") return;
	queueMicrotask(() => input.focus());
});

function openUrl(url: string): void {
	window.open(url, "_blank", "noopener,noreferrer");
}

function submitPrompt(): void {
	const value = prompt?.value.trim() ?? "";
	const allowEmpty = loginState.input?.kind === "prompt" && loginState.input.allowEmpty;
	if (value || allowEmpty) onReply(value);
}

function dismiss(): void {
	if (terminal) onClose();
	else onCancel();
}
</script>

<Dialog
	bind:open
	{title}
	{description}
	testid="login-dialog"
	class="max-h-[85vh] overflow-y-auto"
	onOpenChange={(next) => {
		if (!next) dismiss();
	}}
>
	<div data-provider={loginState.providerId} data-status={loginState.status}>
		{#if loginState.status === "success"}
			<p
				class="flex items-center gap-sm text-feedback-success tr-text-ui"
				data-testid="login-success"
			>
				<Icon name="check" size={16} />
				{providerName} is connected.
			</p>
		{:else if loginState.status === "error"}
			<p
				class="flex items-start gap-sm text-feedback-error tr-text-ui"
				data-testid="login-error"
			>
				<Icon name="triangle-alert" size={16} class="mt-0.5" />
				<span class="min-w-0 break-words">{loginState.error ?? "Login failed."}</span>
			</p>
		{:else}
			<div class="flex flex-col gap-md">
				{#if loginState.url}
					<div class="flex flex-col gap-xs">
						<Button data-testid="login-open-url" onclick={() => openUrl(loginState.url ?? "")}>
							<Icon name="external-link" size={16} />
							Open sign-in page
						</Button>
						<code
							class="select-all break-all rounded-[var(--radius-sm)] bg-control-bg px-sm py-xs tr-code-text text-text-muted"
						>
							{loginState.url}
						</code>
					</div>
				{/if}

				{#if loginState.deviceCode}
					<div
						class="card flex flex-col gap-xs p-md"
						data-testid="login-device-code"
					>
						<span class="text-text-muted tr-text-metadata">
							Enter this code at
							<a
								href={loginState.deviceCode.verificationUri}
								target="_blank"
								rel="noopener noreferrer"
								data-testid="login-device-url"
								class="inline-flex items-center gap-0.5 break-all text-primary underline underline-offset-2 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary"
							>
								{loginState.deviceCode.verificationUri}
								<Icon name="external-link" size={12} />
							</a>
						</span>
						<code class="tr-code-otp select-all text-center text-text-default">
							{loginState.deviceCode.userCode}
						</code>
					</div>
				{/if}

				{#if loginState.input?.kind === "select"}
					<div class="flex flex-col gap-xs">
						{#if loginState.input.message}
							<p class="text-text-muted tr-text-ui">{loginState.input.message}</p>
						{/if}
						{#each loginState.input.options as option (option.id)}
							<button
								type="button"
								data-testid="login-option"
								data-option={option.id}
								onclick={() => onReply(option.id)}
								class="btn justify-start text-left"
								data-variant="outline"
							>
								{option.label}
							</button>
						{/each}
					</div>
				{/if}

				{#if loginState.input?.kind === "prompt"}
					<div class="flex flex-col gap-xs">
						{#if loginState.input.message}
							<p class="text-text-muted tr-text-ui">{loginState.input.message}</p>
						{/if}
						<div class="flex gap-sm">
							<input
								bind:this={prompt}
								class="text-field-input min-w-0 flex-1"
								data-testid="login-input"
								type={loginState.input.secret ? "password" : "text"}
								placeholder={loginState.input.placeholder ?? ""}
								onkeydown={(event) => {
									if (event.key !== "Enter") return;
									event.preventDefault();
									submitPrompt();
								}}
							/>
							<Button data-testid="login-submit" onclick={submitPrompt}>Submit</Button>
						</div>
					</div>
				{/if}

				{#if loginState.progress}
					<p
						class="flex items-center gap-sm text-text-muted tr-text-ui"
						data-testid="login-progress"
					>
						<Icon name="loader-circle" size={16} class="animate-spin" />
						{loginState.progress}
					</p>
				{:else if !loginState.url && !loginState.deviceCode && !loginState.input}
					<p
						class="flex items-center gap-sm text-text-muted tr-text-ui"
						data-testid="login-working"
					>
						<Icon name="loader-circle" size={16} class="animate-spin" />
						Working…
					</p>
				{/if}
			</div>
		{/if}
	</div>

	{#snippet actions()}
		{#if terminal}
			<Button variant="outline" data-testid="login-close" onclick={onClose}>Done</Button>
		{:else}
			<Button variant="outline" data-testid="login-cancel" onclick={onCancel}>Cancel</Button>
		{/if}
	{/snippet}
</Dialog>
