import { expect, test } from "bun:test";
import type { ProviderStatus, WireModel } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	firstModelForProvider,
	SessionModelControls,
	sessionSelectableModels,
	thinkingLevelsForCurrent,
} from "@/chat/session/session-model-controls";

const model: WireModel = {
	provider: "provider-a",
	id: "model-a",
	name: "Model A",
	available: true,
	hidden: false,
	reasoning: true,
	thinkingLevels: ["low", "medium", "high"],
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

test("session model controls admit only configured, available provider models", () => {
	const providerWithOmittedAvailability: ProviderStatus = {
		id: "provider-c",
		name: "Provider C",
		configured: true,
		modelCount: 1,
		availableModelCount: 1,
		acp: false,
	};
	const available = sessionSelectableModels(
		[
			model,
			{ ...model, id: "hidden", hidden: true },
			{ ...model, id: "unavailable", available: false },
			{ ...model, provider: "provider-b", id: "other" },
			{ ...model, provider: "provider-c", id: "omitted-provider-availability" },
		],
		[
			provider,
			{ ...provider, id: "provider-b", available: false },
			providerWithOmittedAvailability,
		],
	);
	expect(available).toEqual([
		model,
		{ ...model, provider: "provider-c", id: "omitted-provider-availability" },
	]);
	expect(firstModelForProvider(available, "provider-a")).toEqual(model);
	expect(firstModelForProvider(available, "provider-b")).toBeNull();
});

test("thinking options preserve Goose's reported order and the current level", () => {
	expect(thinkingLevelsForCurrent("medium", ["off", "low", "medium", "high"])).toEqual([
		"off",
		"low",
		"medium",
		"high",
	]);
	expect(thinkingLevelsForCurrent("custom", ["off", "high"])).toEqual(["custom", "off", "high"]);
});

test("session controls render compact, named selects and do not expose unavailable catalog choices", () => {
	const markup = renderToStaticMarkup(
		<SessionModelControls sessionId="chat" model={model} thinkingLevel="medium" isStreaming />,
	);
	expect(markup).toContain('data-testid="session-model-controls"');
	expect(markup).toContain('data-testid="session-provider-select"');
	expect(markup).toContain('data-testid="session-model-select"');
	expect(markup).toContain('data-testid="session-thinking-select"');
	expect(markup).toContain('disabled=""');
	expect(markup).toContain("Loading providers…");
	expect(markup).toContain("Loading models…");
	expect(markup).toContain("provider-a (current)");
	expect(markup).toContain("Model A (current)");
});
