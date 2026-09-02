import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "@/chat/render/tool-registry";
import { getToolRenderer, getToolSummary } from "@/chat/render/tool-registry";
import { subagentSummary } from "@/chat/tools/subagent/register";
import { SubagentCard } from "@/chat/tools/subagent/subagent-card";

const props = (result: unknown, status: ToolRenderProps["status"] = "done"): ToolRenderProps => ({
	toolCallId: "subagent-call",
	toolName: "subagent",
	args: { task: "Inspect the patch" },
	result,
	status,
	streaming: false,
});

describe("subagent renderer parsing", () => {
	it("renders child status and escapes untrusted result text", () => {
		const markup = renderToStaticMarkup(
			<SubagentCard
				{...props({
					content: [{ type: "text", text: '<script>alert("x")</script>' }],
					details: {
						mode: "single",
						status: "completed",
						childSessionId: "child-1",
						results: [{ runId: "child-1", agent: "child", status: "completed" }],
					},
				})}
			/>,
		);
		expect(markup).toContain("Child completed");
		expect(markup).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
		expect(markup).not.toContain("<script>");
	});

	it("shows bounded recent activity without treating it as a child transcript", () => {
		const markup = renderToStaticMarkup(
			<SubagentCard
				{...props(undefined, "running")}
				toolName="delegate"
				subagentActivity={{
					events: [
						{ childSessionId: "child-1", toolName: "developer__shell" },
						{ childSessionId: "child-2", toolName: '<script>alert("x")</script>' },
					],
					truncated: true,
				}}
			/>,
		);
		expect(markup).toContain("Recent child activity");
		expect(markup).toContain("child-1");
		expect(markup).toContain("child-2");
		expect(markup).toContain("developer__shell");
		expect(markup).toContain("Earlier activity omitted");
		expect(markup).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
		expect(markup).not.toContain("<script>");
	});
});

describe("subagent renderer registration", () => {
	it("registers only supported subagent identities", () => {
		expect(getToolRenderer("subagent")).toBe(SubagentCard);
		expect(getToolRenderer("delegate")).toBe(SubagentCard);
		expect(getToolRenderer("load")).toBe(SubagentCard);
		expect(subagentSummary({ task: "Inspect" })).toBe("subagent · Inspect");
		expect(getToolSummary("subagent", props(undefined))).toBe("subagent · Inspect the patch");
		expect(getToolRenderer("other__delegate")).not.toBe(SubagentCard);
		expect(getToolRenderer("subagent_wait")).not.toBe(SubagentCard);
		expect(getToolRenderer("contact_supervisor")).not.toBe(SubagentCard);
	});
});
