import { expect, test } from "bun:test";
import { buildProviderReport } from "./provider-status";

test("provider report includes every registered provider and model counts", () => {
	const report = buildProviderReport({
		modelProviderIds: new Set(["alpha", "beta", "ambient"]),
		availableProviders: new Set(["alpha"]),
		modelCounts: new Map([
			["alpha", 3],
			["beta", 4],
			["ambient", 1],
		]),
		availableModelCounts: new Map([["alpha", 2]]),
		credentialProviders: ["alpha"],
		oauthProviders: [{ id: "beta", name: "Beta OAuth" }],
		credentialType: (id) => (id === "alpha" ? "api_key" : undefined),
		providerAuth: (id) => (id === "ambient" ? { source: "environment" } : { source: "runtime" }),
		apiKeyLogin: (id) => id === "alpha" || id === "beta",
		displayName: (id) => (id === "alpha" ? "Alpha" : id),
		hasAuth: (id) => id === "alpha" || id === "ambient",
	});

	expect(report.providers.map((provider) => provider.id)).toEqual(["alpha", "ambient", "beta"]);
	expect(report.providers[0]).toMatchObject({
		id: "alpha",
		configured: true,
		kind: "api-key",
		modelCount: 3,
		availableModelCount: 2,
	});
	expect(report.providers[1]).toMatchObject({
		id: "ambient",
		configured: true,
		kind: "env",
		modelCount: 1,
		availableModelCount: 0,
	});
	expect(report.providers[2]).toMatchObject({
		id: "beta",
		name: "Beta OAuth",
		configured: false,
		canOAuth: true,
		canApiKey: true,
		modelCount: 4,
	});
});
