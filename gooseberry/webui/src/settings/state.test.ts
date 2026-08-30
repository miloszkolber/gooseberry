import { beforeEach, expect, test } from "bun:test";
import type { WireModel } from "@gooseberry/contracts";
import { useAppStore } from "../store/app-store";

beforeEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

const model: WireModel = {
	provider: "provider-a",
	id: "model-a",
	name: "Model A",
	contextWindow: 128_000,
	maxTokens: 8_000,
	reasoning: false,
	input: ["text"],
	available: true,
	hidden: false,
};

test("a provider change prevents older model replies from replacing the current refresh", () => {
	const actions = useAppStore.getState();
	const previousVersion = actions.beginModelsRefresh();
	actions.noteProviderChanged();
	const currentVersion = actions.beginModelsRefresh();
	actions.setProviderConfigured(true);

	actions.setModelsForProviderVersion(previousVersion, [model]);
	actions.finishModelsRefresh(previousVersion, { models: [model], complete: true });
	expect(useAppStore.getState()).toMatchObject({
		models: [],
		providerVersion: currentVersion,
		providerConfigured: true,
		modelsRefreshing: true,
		modelsFresh: false,
	});

	actions.finishModelsRefresh(currentVersion, { models: [model], complete: true });
	expect(useAppStore.getState()).toMatchObject({
		models: [model],
		modelsRefreshing: false,
		modelsFresh: true,
	});
	actions.dropModelsFreshness();
	expect(useAppStore.getState()).toMatchObject({ models: [model], modelsFresh: false });
});

test("provider login keeps the active flow when late frames arrive for another login", () => {
	const actions = useAppStore.getState();
	actions.beginLogin("current", "provider-a");
	actions.applyLoginFrame({
		loginId: "current",
		providerId: "provider-a",
		frame: { kind: "prompt", message: "Enter the code", secret: true },
	});
	const waitingForInput = useAppStore.getState().activeLogin;
	actions.beginLogin("current", "provider-a");
	actions.applyLoginFrame({
		loginId: "previous",
		providerId: "provider-b",
		frame: { kind: "error", message: "Expired" },
	});
	expect(useAppStore.getState().activeLogin).toBe(waitingForInput);

	actions.clearLoginInput();
	expect(useAppStore.getState().activeLogin).toEqual({
		loginId: "current",
		providerId: "provider-a",
		status: "active",
	});
	actions.applyLoginFrame({
		loginId: "current",
		providerId: "provider-a",
		frame: { kind: "progress", message: "Connecting" },
	});
	actions.applyLoginFrame({
		loginId: "current",
		providerId: "provider-a",
		frame: { kind: "success" },
	});
	expect(useAppStore.getState().activeLogin).toEqual({
		loginId: "current",
		providerId: "provider-a",
		status: "success",
	});
});
