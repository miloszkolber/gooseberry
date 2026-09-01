import type { McpAppAttachment } from "@gooseberry/contracts";
import type { ReactNode } from "react";
import { toText } from "./tools/tool-helpers";
import { ToolOutput } from "./tools/tool-output";
import type { ToolStatus } from "./types";

export interface ToolRenderProps {
	toolCallId: string;
	toolName: string;
	args: Record<string, unknown>;
	result: unknown;
	app?: McpAppAttachment | undefined;
	status: ToolStatus;
	projectAreaRoot?: string | undefined;
	streaming: boolean;
}

export type ToolChrome = "card" | "bare";

export type ToolProminence = "routine" | "primary";

export type ToolRenderer = (props: ToolRenderProps) => ReactNode;

export type ToolSummary = (props: ToolRenderProps) => string;

export interface ToolRegistrationOptions {
	summary?: ToolSummary;
	chrome?: ToolChrome;
	prominence?: ToolProminence;
	defaultExpanded?: boolean;
}

interface ToolRegistration extends ToolRegistrationOptions {
	renderer: ToolRenderer;
}

const registry = new Map<string, ToolRegistration>();

function registration(toolName: string): ToolRegistration | undefined {
	return (
		registry.get(toolName) ??
		(toolName.endsWith("__browser_command") ? registry.get("browser_command") : undefined)
	);
}

export function registerToolRenderer(
	toolName: string,
	renderer: ToolRenderer,
	options: ToolRegistrationOptions = {},
): void {
	registry.set(toolName, { renderer, ...options });
}

export function getToolRenderer(toolName: string): ToolRenderer {
	return registration(toolName)?.renderer ?? DefaultToolRenderer;
}

export function getToolSummary(toolName: string, props: ToolRenderProps): string {
	return registration(toolName)?.summary?.(props) ?? "";
}

export function getToolChrome(toolName: string): ToolChrome {
	return registration(toolName)?.chrome ?? "card";
}

export interface ResolvedProminence {
	prominence: ToolProminence;
	defaultExpanded: boolean;
}

export function resolveProminence(toolName: string): ResolvedProminence {
	const reg = registration(toolName);
	const prominence = reg?.chrome === "bare" ? "primary" : (reg?.prominence ?? "routine");
	return { prominence, defaultExpanded: reg?.defaultExpanded ?? false };
}

export function DefaultToolRenderer({
	args,
	result,
	status,
	toolName,
}: ToolRenderProps): ReactNode {
	const argsText = toText(args);
	return (
		<div className="flex flex-col gap-xs">
			{argsText && argsText !== "{}" ? (
				<pre className="overflow-auto tr-code-text text-text-muted">{argsText}</pre>
			) : null}
			<ToolOutput result={result} error={status === "error"} />
			{status === "done" &&
			(toolName === "apps__create_app" || toolName === "apps__iterate_app") ? (
				<p className="text-text-muted tr-text-metadata">App saved in Goose.</p>
			) : null}
		</div>
	);
}
