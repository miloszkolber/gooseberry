import { registerToolRenderer } from "../../tool-registry";
import { strArg } from "../tool-helpers";
import { SubagentCard } from "./subagent-card";

export function subagentSummary(args: Record<string, unknown>): string {
	const task = strArg(args, "task");
	return task ? `subagent · ${task}` : "subagent";
}

registerToolRenderer("subagent", SubagentCard, { summary: ({ args }) => subagentSummary(args) });
