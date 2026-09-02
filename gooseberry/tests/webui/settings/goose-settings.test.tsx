import { expect, test } from "bun:test";
import type { ProviderStatus, WireModel } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	agentNameError,
	DefaultSettings,
	defaultModelSuggestions,
	shouldClearAgentEditorAfterMutation,
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
	const markup = renderToStaticMarkup(
		<DefaultSettings
			defaults={{ providerId: provider.id, modelId: "persisted-custom-model" }}
			providers={[provider]}
			models={[hiddenModel]}
			busy={false}
			loading={false}
			onDefaultsChange={() => {}}
			onSave={() => {}}
			onClear={() => {}}
		/>,
	);
	expect(markup).toContain('value="private-provider"');
	expect(markup).toContain('value="persisted-custom-model"');
	expect(markup).not.toContain("Hidden model");
	expect(defaultModelSuggestions([hiddenModel], provider.id)).toEqual([]);
});

test("an older agent mutation cannot clear a newer editor selection", async () => {
	const olderMutation = { sequence: 4, editingId: "older-agent" };
	await Promise.resolve();
	expect(shouldClearAgentEditorAfterMutation("newer-agent", olderMutation, 5)).toBe(false);
});

test("validates agent names by UTF-8 bytes and path separators before submitting", () => {
	expect(agentNameError("Reviewer")).toBeNull();
	expect(agentNameError("bad/name")).toContain("80 UTF-8 bytes");
	expect(agentNameError("🪿".repeat(21))).toContain("80 UTF-8 bytes");
});
