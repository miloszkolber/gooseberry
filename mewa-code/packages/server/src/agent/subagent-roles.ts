import type { ThinkingLevel } from "@mewa-code/contracts";

export type SubagentRole = "scout" | "builder" | "strategist" | "auditor";
export type ModelGroup = "economy" | "balanced" | "strong" | "deep";

export interface SubagentRoleDefinition {
	role: SubagentRole;
	readOnly: boolean;
	groups: readonly ModelGroup[];
	defaultGroup: ModelGroup;
	thinkingLevels: readonly ThinkingLevel[];
	defaultThinkingLevel: ThinkingLevel;
	instructions: string;
}

export const SUBAGENT_ROLES: Record<SubagentRole, SubagentRoleDefinition> = {
	scout: {
		role: "scout",
		readOnly: true,
		groups: ["economy", "balanced"],
		defaultGroup: "economy",
		thinkingLevels: ["minimal", "low", "medium"],
		defaultThinkingLevel: "low",
		instructions:
			"Explore read-only. Gather concrete evidence, locate files and symbols, and report concise findings. Do not modify project state.",
	},
	builder: {
		role: "builder",
		readOnly: false,
		groups: ["balanced", "strong", "deep"],
		defaultGroup: "balanced",
		thinkingLevels: ["low", "medium", "high", "xhigh"],
		defaultThinkingLevel: "medium",
		instructions:
			"Implement the scoped task completely. Preserve unrelated work, verify the change, and return the outcome and evidence.",
	},
	strategist: {
		role: "strategist",
		readOnly: true,
		groups: ["strong", "deep"],
		defaultGroup: "strong",
		thinkingLevels: ["medium", "high", "xhigh"],
		defaultThinkingLevel: "high",
		instructions:
			"Analyze architecture and difficult decisions read-only. Produce an actionable plan with tradeoffs and evidence. Do not modify project state.",
	},
	auditor: {
		role: "auditor",
		readOnly: true,
		groups: ["balanced", "strong", "deep"],
		defaultGroup: "strong",
		thinkingLevels: ["low", "medium", "high", "xhigh"],
		defaultThinkingLevel: "high",
		instructions:
			"Independently review requirements, implementation, security, regressions, and verification. Report findings by severity with evidence. Do not modify project state.",
	},
};

export function roleDefinition(role: SubagentRole): SubagentRoleDefinition {
	return SUBAGENT_ROLES[role];
}

export function rolePrompt(role: SubagentRole, task: string): string {
	const definition = roleDefinition(role);
	return `Role: ${role}\n${definition.instructions}\n\nTask:\n${task}`;
}

export function excludedToolsForRole(role: SubagentRole): string[] {
	return roleDefinition(role).readOnly
		? ["bash", "edit", "write", "subagent", "objective_update"]
		: ["subagent"];
}
