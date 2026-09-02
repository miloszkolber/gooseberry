import { registerToolRenderer } from "../../render/tool-registry";
import { strArg } from "../tool-helpers";
import { SubagentCard } from "./subagent-card";

export function subagentSummary(args: Record<string, unknown>): string {
	const task = strArg(args, "task") || strArg(args, "instructions") || strArg(args, "source");
	return task ? `subagent · ${task}` : "subagent";
}

registerToolRenderer("subagent", SubagentCard, { summary: ({ args }) => subagentSummary(args) });
registerToolRenderer("delegate", SubagentCard, { summary: ({ args }) => subagentSummary(args) });
registerToolRenderer("load", SubagentCard, { summary: ({ args }) => strArg(args, "source") });
