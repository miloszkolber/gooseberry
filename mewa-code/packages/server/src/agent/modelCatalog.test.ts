import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { resetConfigCache, updateConfig } from "../settings";
import { readModelCatalog, toWireModel } from "./agentSessionManager";

let root: string;
const previousDataDir = process.env.MEWA_CODE_DATA_DIR;

function model(provider: string, id: string): Model<string> {
	return {
		provider,
		id,
		name: `${provider} ${id}`,
		api: "faux",
		baseUrl: "http://example.test",
		reasoning: true,
		input: ["text", "image"],
		cost: {
			input: 1,
			output: 2,
			cacheRead: 0.1,
			cacheWrite: 0.2,
			tiers: [{ inputTokensAbove: 200_000, input: 2, output: 4, cacheRead: 0.2, cacheWrite: 0.4 }],
		},
		contextWindow: 1_000_000,
		maxTokens: 128_000,
	};
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "mewa-model-catalog-"));
	process.env.MEWA_CODE_DATA_DIR = root;
	resetConfigCache();
});

afterEach(() => {
	resetConfigCache();
	rmSync(root, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
});

test("wire model includes context, modality, pricing, and availability metadata", () => {
	const wire = toWireModel(model("alpha", "large"), { available: false, hidden: true });
	expect(wire).toMatchObject({
		provider: "alpha",
		id: "large",
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		input: ["text", "image"],
		available: false,
		hidden: true,
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
	});
	expect(wire.cost.tiers?.[0]?.inputTokensAbove).toBe(200_000);
});

test("catalog preserves unavailable models and applies Mewa visibility separately", () => {
	const available = model("alpha", "available");
	const unavailable = model("beta", "unavailable");
	updateConfig({ hiddenModels: [{ provider: "alpha", id: "available" }] });

	const catalog = readModelCatalog({
		getModels: () => [unavailable, available],
		getAvailableSnapshot: () => [available],
	});

	expect(
		catalog.map(({ provider, id, available, hidden }) => ({ provider, id, available, hidden })),
	).toEqual([
		{ provider: "alpha", id: "available", available: true, hidden: true },
		{ provider: "beta", id: "unavailable", available: false, hidden: false },
	]);
});
