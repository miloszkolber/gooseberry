import type { SkillDecision } from "@mewa-code/contracts";

export type { SkillDecision };

export interface SkillAdmissionContext {
	trusted: boolean;
	disabled: readonly string[];
	disabledGroups: readonly string[];
	overrides: Readonly<Record<string, "on" | "off">>;
}

export interface SkillFacts {
	name: string;
	isProjectSkill: boolean;
	group: string;
	isPlugin: boolean;
}

export function decideSkill(skill: SkillFacts, ctx: SkillAdmissionContext): SkillDecision {
	if (skill.isProjectSkill) {
		if (!ctx.trusted) return "untrusted";
	}
	const override = ctx.overrides[skill.name];
	if (override === "off") return "disabled";
	if (override === "on") return "load";
	if (ctx.disabledGroups.includes(skill.group)) return "disabled";
	if (skill.isPlugin && ctx.disabledGroups.includes("@plugins")) return "disabled";
	if (ctx.disabled.includes(skill.name)) return "disabled";
	return "load";
}

export function isSkillLoaded(skill: SkillFacts, ctx: SkillAdmissionContext): boolean {
	return decideSkill(skill, ctx) === "load";
}
