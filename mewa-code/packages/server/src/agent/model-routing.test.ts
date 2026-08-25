import { expect, test } from "bun:test";
import type { WireModel } from "@mewa-code/contracts";
import { classifyModel, routeSubagentModel } from "./model-routing";
import { excludedToolsForRole } from "./subagent-roles";

function model(id: string, input: number, output: number, available = true): WireModel {
	return {
		id,
		name: id,
		provider: "test",
		contextWindow: 100_000,
		maxTokens: 8_000,
		reasoning: true,
		thinkingLevels: ["low", "medium", "high"],
		input: ["text"],
		cost: { input, output, cacheRead: 0, cacheWrite: 0 },
		available,
		hidden: false,
	};
}

test("classifies providers centrally and chooses the cheapest suitable healthy model", () => {
	const expensive = model("gpt-5", 10, 20);
	const cheap = model("claude-sonnet", 2, 4);
	const unavailable = model("gpt-5.2", 1, 1, false);
	expect(classifyModel(cheap)).toBe("strong");
	expect(classifyModel(model("gpt-5-mini", 1, 1))).toBe("economy");
	const routed = routeSubagentModel([expensive, cheap, unavailable], "auditor", "strong", "high");
	expect(routed.model.id).toBe("claude-sonnet");
	expect(routed.requestedGroup).toBe("strong");
});

test("roles enforce routing ranges, read-only tools, and no recursive delegation", () => {
	expect(() => routeSubagentModel([model("gpt-5", 1, 1)], "scout", "deep")).toThrow("cannot use");
	expect(excludedToolsForRole("scout")).toEqual(
		expect.arrayContaining(["bash", "edit", "write", "subagent"]),
	);
	expect(excludedToolsForRole("builder")).toEqual(["subagent"]);
});
