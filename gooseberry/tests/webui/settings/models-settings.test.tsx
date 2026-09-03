import { expect, test } from "bun:test";
import type { ProviderStatus, WireModel } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	configuredAvailableModels,
	filterModels,
	ModelCatalogList,
	ModelsSettings,
} from "@/settings/sections/models-settings";

const model: WireModel = {
	provider: "provider-a",
	id: "model-a",
	name: "Model A",
	contextWindow: 1_100_000,
	maxTokens: 128_000,
	reasoning: true,
	thinkingLevels: ["low", "medium", "high"],
	input: ["text", "image"],
	cost: {
		currency: "€",
		input: 1.25,
		output: 5,
		cacheRead: 0.125,
		cacheWrite: 1.5,
		tiers: [{ inputTokensAbove: 200_000, input: 2.5, output: 10, cacheRead: 0.25, cacheWrite: 3 }],
	},
	available: true,
	hidden: false,
};

const provider: ProviderStatus = {
	id: "provider-a",
	name: "Provider A",
	configured: true,
	available: true,
	modelCount: 1,
	availableModelCount: 1,
	acp: false,
};

test("filters by provider and renders context, modality, cost, and visibility", () => {
	const providers = new Map([[provider.id, provider]]);
	expect(filterModels([model], providers, "provider a")).toHaveLength(1);
	expect(filterModels([model], providers, "missing")).toHaveLength(0);

	const markup = renderToStaticMarkup(
		<ModelCatalogList
			models={[model, { ...model, id: "hidden", name: "Hidden", hidden: true, available: false }]}
			providers={providers}
			busyModel={null}
			onSetVisibility={() => {}}
		/>,
	);
	expect(markup).toContain("1.1M ctx · 128K out");
	expect(markup).toContain("Image");
	expect(markup).toContain("Reasoning");
	expect(markup).toContain("In €1.25 · Out €5 / 1M");
	expect(markup).toContain("Hidden");
	expect(markup).toContain("Unavailable");
	expect(markup).not.toContain("Routing");
});

test("shows only models that Goose reports for configured available providers", () => {
	const providerWithOmittedAvailability: ProviderStatus = {
		id: "omitted",
		name: "Omitted availability",
		configured: true,
		modelCount: 1,
		availableModelCount: 1,
		acp: false,
	};
	const providers = new Map([
		[provider.id, provider],
		["unavailable", { ...provider, id: "unavailable", available: false }],
		["unconfigured", { ...provider, id: "unconfigured", configured: false }],
		[providerWithOmittedAvailability.id, providerWithOmittedAvailability],
	]);
	const catalog = configuredAvailableModels(
		[
			model,
			{ ...model, id: "model-unavailable", available: false },
			{ ...model, provider: "unavailable", id: "model-provider-unavailable" },
			{ ...model, provider: "unconfigured", id: "model-provider-unconfigured" },
			{ ...model, provider: "omitted", id: "model-provider-omitted-availability" },
		],
		providers,
	);
	expect(catalog).toEqual([
		model,
		{ ...model, provider: "omitted", id: "model-provider-omitted-availability" },
	]);
});

test("labels bulk visibility controls as applying beyond the filtered catalog", () => {
	const markup = renderToStaticMarkup(<ModelsSettings />);
	expect(markup).toContain("Hide all");
	expect(markup).toContain("Show all");
	expect(markup).toContain("including models from disconnected providers");
});
