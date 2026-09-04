<script lang="ts">
import type {
	GooseExtensionCatalog,
	GooseExtensionSummary,
	GooseSessionExtensionSummary,
	GooseToolPermission,
	GooseToolSummary,
	McpGatewayCatalog,
	McpGatewayModule,
} from "@gooseberry/contracts";
import { onDestroy } from "svelte";
import Button from "@/components/button.svelte";
import { errorText, getTransport } from "@/connection";
import { appStore, selectActiveContentTab, selectActiveProjectArea } from "@/store";
import {
	extensionWarningText,
	filterTools,
	isSessionInventoryCurrent,
	permissionLabel,
	uniqueExtensions,
} from "./goose-tools-settings";

let catalog = $state<GooseExtensionCatalog | null>(null);
let gatewayCatalog = $state<McpGatewayCatalog | null>(null);
let extensions = $state<GooseSessionExtensionSummary[]>([]);
let tools = $state<GooseToolSummary[]>([]);
let loadedSessionTarget = $state<string | null>(null);
let query = $state("");
let loading = $state(true);
let busy = $state<string | null>(null);
let error = $state<string | null>(null);
let loadSequence = 0;
let mounted = true;

let activeArea = $derived(selectActiveProjectArea($appStore));
let activeTab = $derived(activeArea ? selectActiveContentTab($appStore, activeArea.id) : null);
let activeProjectId = $derived(activeArea?.projectId ?? null);
let activeSessionId = $derived(activeTab?.kind === "chat" ? activeTab.sessionId : null);
let activeTarget = $derived(`${activeProjectId ?? ""}\0${activeSessionId ?? ""}`);
let configuredNames = $derived(
	new Set(catalog?.configured.map((extension) => extension.name) ?? []),
);
let sessionNames = $derived(new Set(extensions.map((extension) => extension.name)));
let knownSessionExtensions = $derived(
	uniqueExtensions([...(catalog?.configured ?? []), ...(catalog?.available ?? [])]).filter(
		(extension) => !sessionNames.has(extension.name),
	),
);
let visibleTools = $derived(filterTools(tools, query));
let hasActiveChat = $derived(activeProjectId !== null && activeSessionId !== null);
let sessionInventoryCurrent = $derived(
	hasActiveChat && isSessionInventoryCurrent(loadedSessionTarget, activeTarget, loading),
);
let warning = $derived(extensionWarningText(catalog?.warningCount ?? 0));
const permissionOptions = Object.entries(permissionLabel) as [GooseToolPermission, string][];

async function load(): Promise<void> {
	const sequence = ++loadSequence;
	const target = activeTarget;
	const projectId = activeProjectId;
	const sessionId = activeSessionId;
	loading = true;
	error = null;
	loadedSessionTarget = null;
	try {
		const [nextCatalog, nextGatewayCatalog] = await Promise.all([
			getTransport().request("goose.extensionList", {}),
			getTransport().request("mcpGateway.catalog", {}),
		]);
		if (!mounted || sequence !== loadSequence || target !== activeTarget) return;
		catalog = nextCatalog;
		gatewayCatalog = nextGatewayCatalog;
		if (projectId && sessionId) {
			const [nextExtensions, nextTools] = await Promise.all([
				getTransport().request("session.extensionList", { projectId, sessionId }),
				getTransport().request("session.toolList", { projectId, sessionId }),
			]);
			if (!mounted || sequence !== loadSequence || target !== activeTarget) return;
			extensions = nextExtensions;
			tools = nextTools;
			loadedSessionTarget = target;
		} else {
			extensions = [];
			tools = [];
			loadedSessionTarget = null;
		}
	} catch (cause) {
		if (!mounted || sequence !== loadSequence || target !== activeTarget) return;
		error = errorText(cause);
	} finally {
		if (mounted && sequence === loadSequence && target === activeTarget) loading = false;
	}
}

$effect(() => {
	void activeTarget;
	void load();
});

onDestroy(() => {
	mounted = false;
	loadSequence += 1;
});

function sessionParams(): { projectId: string; sessionId: string } {
	if (!activeProjectId || !activeSessionId) throw new Error("An active chat is required");
	return { projectId: activeProjectId, sessionId: activeSessionId };
}

async function mutate(key: string, action: () => Promise<unknown>): Promise<void> {
	const target = activeTarget;
	busy = key;
	error = null;
	try {
		await action();
		await load();
	} catch (cause) {
		if (target === activeTarget) error = errorText(cause);
	} finally {
		if (mounted) busy = null;
	}
}

function setToolPermission(tool: GooseToolSummary, permission: GooseToolPermission): void {
	void mutate(`permission:${tool.name}`, () =>
		getTransport().request("session.toolPermissionSet", {
			...sessionParams(),
			toolName: tool.name,
			permission,
		}),
	);
}

function gatewayModuleLabel(module: McpGatewayModule): string {
	if (module.binding === "conflict") return "Conflict";
	if (module.binding === "unavailable") return "Goose unavailable";
	if (module.binding === "enabled") return "Enabled in Goose";
	if (module.binding === "disabled") return "Disabled in Goose";
	return "Not configured in Goose";
}

function gatewayActionLabel(module: McpGatewayModule): string {
	return module.binding === "enabled" ? "Disable" : "Use in Goose";
}

function setGatewayEnabled(module: McpGatewayModule, enabled: boolean): void {
	void mutate(`gateway:${module.id}`, () =>
		getTransport().request("mcpGateway.moduleSetGooseEnabled", {
			moduleId: module.id,
			enabled,
			...(gatewayCatalog?.gateway.revision ? { revision: gatewayCatalog.gateway.revision } : {}),
		}),
	);
}
</script>

{#snippet ExtensionLabel(extension: GooseExtensionSummary)}
	<div class="min-w-0">
		<div class="break-words text-text-default tr-text-ui">
			{extension.displayName ?? extension.name}
		</div>
		{#if extension.description}
			<p class="break-words text-text-muted tr-text-metadata">{extension.description}</p>
		{/if}
	</div>
{/snippet}

{#snippet ToolInventory(tool: GooseToolSummary)}
	<div
		class="card flex flex-wrap items-start justify-between gap-sm p-sm"
		data-testid="tool-inventory"
	>
		<div class="min-w-0">
			<div class="break-words text-text-default tr-text-ui">{tool.name}</div>
			<p class="break-words text-text-muted tr-text-metadata">
				{tool.description || "No description supplied by Goose."}
				{tool.parameters.length ? ` Parameters: ${tool.parameters.join(", ")}` : ""}
			</p>
		</div>
		<label class="field shrink-0 text-text-muted tr-text-metadata">
			Permission
			<select
				class="select"
				aria-label={`Permission for ${tool.name}`}
				value={tool.permission ?? "goose_default"}
				disabled={busy !== null}
				onchange={(event) => {
					const permission = event.currentTarget.value;
					if (permission !== "goose_default") {
						setToolPermission(tool, permission as GooseToolPermission);
					}
				}}
			>
				<option value="goose_default" disabled>Goose default</option>
				{#each permissionOptions as [permission, label] (permission)}
					<option value={permission}>{label}</option>
				{/each}
			</select>
		</label>
	</div>
{/snippet}

<div data-testid="settings-goose-tools" class="flex flex-col gap-lg">
	<div class="flex flex-wrap items-start justify-between gap-sm">
		<div>
			<h3 class="tr-title-section text-text-default">Extensions and tools</h3>
			<p class="text-text-muted tr-text-metadata">
				Goose owns global extension configuration and global tool permissions.
			</p>
		</div>
		<Button size="sm" variant="outline" disabled={loading || busy !== null} onclick={() => void load()}>
			Refresh
		</Button>
	</div>
	{#if error}<p role="alert" class="text-feedback-error tr-text-metadata">{error}</p>{/if}
	{#if busy}
		<p role="status" aria-live="polite" class="text-text-muted tr-text-metadata">
			Updating Goose settings…
		</p>
	{/if}

	<section class="flex flex-col gap-sm" aria-labelledby="mcp-modules-heading">
		<div>
			<h4 id="mcp-modules-heading" class="tr-text-eyebrow text-text-muted">
				Gooseberry MCP modules
			</h4>
			<p class="text-text-muted tr-text-metadata">
				Published modules stay available in Gooseberry MCP when disabled here.
			</p>
		</div>
		{#if loading && !gatewayCatalog}
			<p role="status" class="text-text-muted tr-text-metadata">Checking MCP host…</p>
		{:else if gatewayCatalog?.gateway.state === "not-configured"}
			<p class="text-text-muted tr-text-metadata">
				Gooseberry MCP is not configured. The standalone Browser service remains available.
			</p>
		{:else if gatewayCatalog?.gateway.state === "unreachable" || gatewayCatalog?.gateway.state === "incompatible"}
			<p role="status" class="text-text-muted tr-text-metadata">
				{gatewayCatalog.gateway.detail ?? "Gooseberry MCP is unavailable."}
			</p>
		{:else if gatewayCatalog?.modules.length === 0}
			<p class="text-text-muted tr-text-metadata">No MCP modules are published.</p>
		{:else}
			{#each gatewayCatalog?.modules ?? [] as module (module.id)}
				<div class="card flex flex-wrap items-center justify-between gap-sm p-sm" data-testid="mcp-module-row">
					{@render ExtensionLabel({
						name: module.extensionName,
						displayName: module.displayName,
						description: module.description,
						type: "mcp",
					})}
					<div class="flex items-center gap-xs">
						<span class="text-text-muted tr-text-metadata">{gatewayModuleLabel(module)}</span>
						<Button
							size="sm"
							variant="outline"
						disabled={
								busy !== null ||
								module.binding === "conflict" ||
								module.binding === "unavailable" ||
								(module.state !== "ready" && module.binding !== "enabled")
							}
							aria-label={`${gatewayActionLabel(module)} ${module.displayName}`}
							onclick={() => setGatewayEnabled(module, module.binding !== "enabled")}
						>
							{gatewayActionLabel(module)}
						</Button>
					</div>
				</div>
			{/each}
		{/if}
	</section>

	<section class="flex flex-col gap-sm" aria-labelledby="global-extensions-heading">
		<div>
			<h4 id="global-extensions-heading" class="tr-text-eyebrow text-text-muted">
				Global extensions
			</h4>
			<p class="text-text-muted tr-text-metadata">Changes persist in Goose configuration.</p>
		</div>
		{#if loading}
			<p role="status" class="text-text-muted tr-text-metadata">Loading extensions…</p>
		{/if}
		{#if !loading && catalog?.configured.length === 0}
			<p class="text-text-muted tr-text-metadata">No extensions are configured in Goose.</p>
		{/if}
		{#if warning}<p class="text-text-muted tr-text-metadata">{warning}</p>{/if}
		{#each catalog?.configured ?? [] as extension (extension.configKey ?? extension.name)}
			<div class="card flex flex-wrap items-center justify-between gap-sm p-sm">
				{@render ExtensionLabel(extension)}
				<div class="flex gap-xs">
					<Button
						size="sm"
						variant="outline"
						disabled={!extension.configKey || loading || busy !== null}
						aria-label={`${extension.enabled ? "Disable" : "Enable"} ${extension.displayName ?? extension.name}`}
						onclick={() =>
							void mutate(`enable:${extension.configKey}`, () =>
								getTransport().request("goose.extensionSetEnabled", {
									configKey: extension.configKey ?? "",
									enabled: !extension.enabled,
								}),
							)}
					>
						{extension.enabled ? "Disable" : "Enable"}
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={!extension.configKey || loading || busy !== null}
						aria-label={`Remove ${extension.displayName ?? extension.name}`}
						onclick={() =>
							void mutate(`remove:${extension.configKey}`, () =>
								getTransport().request("goose.extensionRemove", {
									configKey: extension.configKey ?? "",
								}),
							)}
					>
						Remove
					</Button>
				</div>
			</div>
		{/each}
		{#each (catalog?.available ?? []).filter(
			(extension) =>
				(extension.type === "builtin" || extension.type === "platform") &&
				!configuredNames.has(extension.name),
		) as extension (extension.name)}
			<div class="card flex flex-wrap items-center justify-between gap-sm p-sm">
				{@render ExtensionLabel(extension)}
				<Button
					size="sm"
					disabled={loading || busy !== null}
					aria-label={`Add ${extension.displayName ?? extension.name}`}
					onclick={() =>
						void mutate(`add:${extension.name}`, () =>
							getTransport().request("goose.extensionAdd", {
								name: extension.name,
								enabled: true,
							}),
						)}
				>
					Add
				</Button>
			</div>
		{/each}
	</section>

	<section class="flex flex-col gap-sm" aria-labelledby="session-tools-heading">
		<h4 id="session-tools-heading" class="tr-text-eyebrow text-text-muted">Active chat tools</h4>
		{#if !hasActiveChat}
			<p class="text-text-muted tr-text-metadata">
				Open a chat in the current project to manage its effective extensions and tools.
			</p>
		{:else if !sessionInventoryCurrent}
			<p role="status" class="text-text-muted tr-text-metadata">
				{loading
					? "Loading active chat extensions and tools…"
					: "Active chat tools are unavailable. Refresh to try again."}
			</p>
		{:else}
			<p class="text-text-muted tr-text-metadata">
				Session extensions affect this chat. Tool permission changes are global in Goose.
			</p>
			<div class="flex flex-wrap gap-sm">
				{#each extensions as extension (extension.extensionKey)}
					<div class="card flex items-center gap-xs p-xs">
						<span class="text-text-default tr-text-ui">
							{extension.displayName ?? extension.name}
						</span>
						<Button
							size="sm"
							variant="ghost"
							disabled={busy !== null}
							aria-label={`Remove ${extension.displayName ?? extension.name} from active chat`}
							onclick={() =>
								void mutate(`session-remove:${extension.extensionKey}`, () =>
									getTransport().request("session.extensionRemove", {
										...sessionParams(),
										extensionKey: extension.extensionKey,
									}),
								)}
						>
							Remove
						</Button>
					</div>
				{/each}
				{#each knownSessionExtensions as extension (extension.name)}
					<Button
						size="sm"
						variant="outline"
						disabled={busy !== null}
						onclick={() =>
							void mutate(`session-add:${extension.name}`, () =>
								getTransport().request("session.extensionAdd", {
									...sessionParams(),
									name: extension.name,
								}),
							)}
					>
						Add {extension.displayName ?? extension.name}
					</Button>
				{/each}
			</div>
			<label class="field text-text-default tr-text-ui">
				Search tools
				<input class="text-field-input" bind:value={query} />
			</label>
			{#if !loading && visibleTools.length === 0}
				<p class="text-text-muted tr-text-metadata">No tools match this chat.</p>
			{/if}
			{#each visibleTools as tool (tool.name)}
				{@render ToolInventory(tool)}
			{/each}
		{/if}
	</section>
</div>
