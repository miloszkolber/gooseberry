import type { ThinkingLevel, WireModel } from "@mewa-code/contracts";
import { type ModelGroup, roleDefinition, type SubagentRole } from "./subagent-roles";

const GROUP_RANK: Record<ModelGroup, number> = {
	economy: 0,
	balanced: 1,
	strong: 2,
	deep: 3,
};

/** Provider/model knowledge is intentionally isolated in this table. */
const MODEL_CLASSIFIERS: readonly { pattern: RegExp; group: ModelGroup }[] = [
	{ pattern: /(?:mini|nano|flash-lite|small|codestral|qwen)/i, group: "economy" },
	{ pattern: /(?:opus|o3-pro|gpt-5(?:\.\d+)?-pro|gemini-.*ultra)/i, group: "deep" },
	{ pattern: /(?:sonnet|gpt-5(?:\.\d+)?|o3|o1|gemini-.*pro|deepseek-r1)/i, group: "strong" },
	{
		pattern: /(?:haiku|gpt-4\.1|gpt-4o|o4-mini|gemini-.*flash|mistral-large|deepseek-v3)/i,
		group: "balanced",
	},
];

export function classifyModel(
	model: Pick<WireModel, "provider" | "id" | "name" | "reasoning">,
): ModelGroup {
	const identity = `${model.provider}/${model.id} ${model.name}`;
	for (const classifier of MODEL_CLASSIFIERS) {
		if (classifier.pattern.test(identity)) return classifier.group;
	}
	return model.reasoning ? "strong" : "balanced";
}

function estimatedCost(model: WireModel): number {
	return model.cost.input + model.cost.output * 2 + model.cost.cacheRead * 0.25;
}

export interface RoutedSubagentModel {
	model: WireModel;
	requestedGroup: ModelGroup;
	resolvedGroup: ModelGroup;
	thinkingLevel: ThinkingLevel;
}

export function routeSubagentModel(
	models: readonly WireModel[],
	role: SubagentRole,
	requestedGroup?: ModelGroup,
	requestedThinking?: ThinkingLevel,
): RoutedSubagentModel {
	const definition = roleDefinition(role);
	const group = requestedGroup ?? definition.defaultGroup;
	if (!definition.groups.includes(group)) {
		throw new Error(`The ${role} role cannot use the ${group} model group.`);
	}
	const thinkingLevel = requestedThinking ?? definition.defaultThinkingLevel;
	if (!definition.thinkingLevels.includes(thinkingLevel)) {
		throw new Error(`The ${role} role cannot use ${thinkingLevel} reasoning.`);
	}
	const available = models.filter((model) => model.available);
	if (available.length === 0)
		throw new Error("No healthy visible Pi model is available for a subagent.");
	const requestedRank = GROUP_RANK[group];
	const suitable = available.filter((model) => GROUP_RANK[classifyModel(model)] >= requestedRank);
	const candidates = suitable.length > 0 ? suitable : available;
	const model = [...candidates].sort((a, b) => {
		const cost = estimatedCost(a) - estimatedCost(b);
		if (cost !== 0) return cost;
		const qualityDistance =
			Math.abs(GROUP_RANK[classifyModel(a)] - requestedRank) -
			Math.abs(GROUP_RANK[classifyModel(b)] - requestedRank);
		return qualityDistance || `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`);
	})[0];
	if (!model) throw new Error("No Pi model is available for a subagent.");
	return { model, requestedGroup: group, resolvedGroup: classifyModel(model), thinkingLevel };
}
