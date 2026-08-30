import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "@/chat/tool-registry";
import { getToolRenderer, getToolSummary } from "@/chat/tool-registry";
import { subagentSummary } from "@/chat/tools/subagent/register";
import { SubagentCard, subagentDetails } from "@/chat/tools/subagent/subagent-card";

const props = (result: unknown, status: ToolRenderProps["status"] = "done"): ToolRenderProps => ({
	toolCallId: "subagent-call",
	toolName: "subagent",
	args: { task: "Inspect the patch" },
	result,
	status,
	streaming: false,
});

describe("subagent renderer parsing", () => {
	it("extracts bounded run and child details", () => {
		expect(
			subagentDetails({
				details: {
					mode: "single",
					runId: "run-1",
					parentSessionId: "parent-1",
					childSessionId: "child-1",
					status: "completed",
					results: [
						{
							runId: "child-1",
							agent: "child",
							task: "Inspect",
							status: "completed",
							model: { provider: "faux", id: "model" },
							thinkingLevel: "medium",
							outputState: "present",
						},
					],
				},
			}),
		).toEqual({
			mode: "single",
			runId: "run-1",
			parentSessionId: "parent-1",
			childSessionId: "child-1",
			status: "completed",
			results: [
				{
					runId: "child-1",
					agent: "child",
					task: "Inspect",
					status: "completed",
					model: { provider: "faux", id: "model" },
					thinkingLevel: "medium",
					outputState: "present",
				},
			],
		});
	});

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

	it("shows a bounded running state", () => {
		const markup = renderToStaticMarkup(<SubagentCard {...props(undefined, "running")} />);
		expect(markup).toContain("Subagent running");
	});
});

describe("subagent renderer registration", () => {
	it("registers only the blocking subagent tool", () => {
		expect(getToolRenderer("subagent")).toBe(SubagentCard);
		expect(subagentSummary({ task: "Inspect" })).toBe("subagent · Inspect");
		expect(getToolSummary("subagent", props(undefined))).toBe("subagent · Inspect the patch");
		expect(getToolRenderer("subagent_wait")).not.toBe(SubagentCard);
		expect(getToolRenderer("contact_supervisor")).not.toBe(SubagentCard);
	});
});
