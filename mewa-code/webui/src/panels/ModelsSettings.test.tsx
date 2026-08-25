import { expect, test } from "bun:test";
import type { ProviderStatus, WireModel } from "@mewa-code/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	filterModels,
	formatModelPrice,
	formatTokenCount,
	ModelCatalogList,
} from "./ModelsSettings";

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
	modelCount: 1,
	availableModelCount: 1,
};

test("formats model limits and prices for the management UI", () => {
	expect(formatTokenCount(1_100_000)).toBe("1.1M");
	expect(formatTokenCount(128_000)).toBe("128K");
	expect(formatModelPrice(0)).toBe("$0");
	expect(formatModelPrice(1.25)).toBe("$1.25");
});

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
	expect(markup).toContain("In $1.25 · Out $5 / 1M");
	expect(markup).toContain("Hidden");
	expect(markup).toContain("Unavailable");
});
