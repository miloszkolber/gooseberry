import { registerToolRenderer } from "../../render/tool-registry";
import { strArg } from "../tool-helpers";
import { SignetCard } from "./signet-card";

export function signetSummary(args: Record<string, unknown>): string {
	return strArg(args, "query") || strArg(args, "content") || "memory";
}

registerToolRenderer("signet_recall", SignetCard, { summary: ({ args }) => signetSummary(args) });
registerToolRenderer("signet_source_search", SignetCard, {
	summary: ({ args }) => signetSummary(args),
});
registerToolRenderer("signet_session_search", SignetCard, {
	summary: ({ args }) => signetSummary(args),
});
registerToolRenderer("signet_remember", SignetCard, { summary: ({ args }) => signetSummary(args) });
