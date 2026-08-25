import { registerToolRenderer } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { SubagentCard } from "./SubagentCard";

export function subagentSummary(args: Record<string, unknown>): string {
	const action = strArg(args, "action");
	if (action) return `action: ${action}`;
	const agent = strArg(args, "agent");
	const task = strArg(args, "task");
	return [agent || "delegation", task].filter(Boolean).join(" · ");
}

registerToolRenderer("subagent", SubagentCard, { summary: ({ args }) => subagentSummary(args) });
registerToolRenderer("subagent_wait", SubagentCard, {
	summary: ({ args }) => strArg(args, "runId") || strArg(args, "id") || "wait for subagents",
});
registerToolRenderer("contact_supervisor", SubagentCard, {
	summary: ({ args }) => strArg(args, "message") || "contact supervisor",
});
