import { registerToolRenderer } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { SubagentCard } from "./SubagentCard";

export function subagentSummary(args: Record<string, unknown>): string {
	const task = strArg(args, "task");
	return task ? `subagent · ${task}` : "subagent";
}

registerToolRenderer("subagent", SubagentCard, { summary: ({ args }) => subagentSummary(args) });
