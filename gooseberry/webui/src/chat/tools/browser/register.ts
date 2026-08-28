import { registerToolRenderer } from "../../tool-registry";
import { strArg } from "../tool-helpers";
import { BrowserCard } from "./browser-card";

export function browserSummary(args: Record<string, unknown>): string {
	const command = strArg(args, "command");
	const session = strArg(args, "session");
	return [command || "browser", session ? `in ${session}` : ""].filter(Boolean).join(" ");
}

registerToolRenderer("browser", BrowserCard, { summary: ({ args }) => browserSummary(args) });
