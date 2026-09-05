import { expect, test } from "bun:test";
import type { ProviderStatus, WireModel } from "@gooseberry/contracts";
import {
	agentNameError,
	autoCompactThresholdPercent,
	defaultModelSuggestions,
	defaultProviderSelectable,
	defaultSettingsView,
	parseAutoCompactThreshold,
	shouldClearAgentEditorAfterMutation,
	unavailableDefaultProviderOption,
} from "@/settings/sections/goose-settings";

test("default providers come from configured available status, even without visible models", () => {
	const provider: ProviderStatus = {
		id: "private-provider",
		name: "Private provider",
		configured: true,
		available: true,
		modelCount: 0,
		availableModelCount: 0,
		acp: false,
	};
	const hiddenModel: WireModel = {
		provider: provider.id,
		id: "hidden-model",
		name: "Hidden model",
		available: true,
		hidden: true,
	};
	const defaults = { providerId: provider.id, modelId: "persisted-custom-model" };
	const view = defaultSettingsView(defaults, [provider], [hiddenModel]);

	expect(view.defaults).toEqual(defaults);
	expect(view.providers).toEqual([provider]);
	expect(view.models).toEqual([]);
	expect(defaultModelSuggestions([hiddenModel], provider.id)).toEqual([]);
});

test("retains an unavailable persisted provider as a disabled current selection", () => {
	const provider: ProviderStatus = {
		id: "temporarily-offline",
		name: "Temporarily offline",
		configured: true,
		available: false,
		modelCount: 1,
		availableModelCount: 0,
		acp: false,
	};

	expect(defaultProviderSelectable(provider.id, [provider])).toBe(false);
	expect(unavailableDefaultProviderOption(provider.id, [provider])).toEqual({
		id: provider.id,
		name: provider.name,
	});
	expect(unavailableDefaultProviderOption("missing-provider", [])).toEqual({
		id: "missing-provider",
		name: "missing-provider",
	});
	expect(defaultProviderSelectable(provider.id, [{ ...provider, available: true }])).toBe(true);
	expect(
		unavailableDefaultProviderOption(provider.id, [{ ...provider, available: true }]),
	).toBeNull();
});

test("an older agent mutation cannot clear a newer editor selection", async () => {
	const olderMutation = { sequence: 4, editingId: "older-agent" };
	await Promise.resolve();
	expect(shouldClearAgentEditorAfterMutation("newer-agent", olderMutation, 5)).toBe(false);
});

test("normalizes Svelte number-input threshold values, including a cleared field", () => {
	expect(parseAutoCompactThreshold(72.5)).toEqual({ valid: true, value: 0.725 });
	expect(parseAutoCompactThreshold(undefined)).toEqual({ valid: true });
	expect(parseAutoCompactThreshold(0)).toEqual({ valid: false });
	expect(parseAutoCompactThreshold(Number.NaN)).toEqual({ valid: false });
	expect(parseAutoCompactThreshold(100.1)).toEqual({ valid: false });
});

test("reconciles a cleared threshold with the canonical save response", () => {
	expect(parseAutoCompactThreshold(undefined)).toEqual({ valid: true });
	expect(autoCompactThresholdPercent({ autoCompactThreshold: 0.8 })).toBe(80);
	expect(autoCompactThresholdPercent({})).toBeUndefined();
});

test("validates agent names by UTF-8 bytes and path separators before submitting", () => {
	expect(agentNameError("Reviewer")).toBeNull();
	expect(agentNameError("bad/name")).toContain("80 UTF-8 bytes");
	expect(agentNameError("bad\\name")).toContain("80 UTF-8 bytes");
	expect(agentNameError("🪿".repeat(21))).toContain("80 UTF-8 bytes");
});

test("the Svelte editor retains the default and agent form contracts", async () => {
	const source = await Bun.file(
		new URL("../../../webui/src/settings/sections/goose-settings.svelte", import.meta.url),
	).text();
	for (const testId of [
		"settings-goose",
		"default-provider",
		"default-model",
		"auto-compact-threshold",
		"goose-thinking-effort",
		"agent-catalog-project",
		"agent-row",
		"agent-instructions",
		"agent-model",
	]) {
		expect(source).toContain(`data-testid="${testId}"`);
	}
	expect(source).toContain('confirmTestId="confirm-remove-agent"');
	expect(source).toContain("bind:value={draft.instructions}");
	expect(source).toContain("defaultModelSuggestions(models, defaults.providerId)");
	expect(source).toContain("(current, unavailable)");
	expect(source).toContain(
		"disabled={busy || loading || !defaultsReady || !selectedDefaultProviderAvailable}",
	);
	expect(source).toContain("applyPreferences(saved)");
});
