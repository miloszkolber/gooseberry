import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "../../toolRegistry";
import { getToolRenderer, getToolSummary } from "../../toolRegistry";
import { subagentSummary } from "./register";
import { SubagentCard, subagentDetails } from "./SubagentCard";

const props = (result: unknown, status: ToolRenderProps["status"] = "done"): ToolRenderProps => ({
	toolCallId: "subagent-call",
	toolName: "subagent",
	args: { agent: "reviewer", task: "Inspect the patch" },
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
					results: [{ agent: "reviewer", exitCode: 0, outputState: "present" }, null],
				},
			}),
		).toEqual({
			mode: "single",
			runId: "run-1",
			results: [{ agent: "reviewer", exitCode: 0, outputState: "present" }],
		});
	});

	it("renders child status and escapes untrusted result text", () => {
		const markup = renderToStaticMarkup(
			<SubagentCard
				{...props({
					content: [{ type: "text", text: '<script>alert("x")</script>' }],
					details: {
						mode: "workflow",
						results: [{ agent: "reviewer", exitCode: 0 }],
					},
				})}
			/>,
		);
		expect(markup).toContain("reviewer: completed");
		expect(markup).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
		expect(markup).not.toContain("<script>");
	});

	it("shows a bounded running state", () => {
		const markup = renderToStaticMarkup(<SubagentCard {...props(undefined, "running")} />);
		expect(markup).toContain("Subagent running");
	});
});

describe("subagent renderer registration", () => {
	it("registers parent and child-safe tools", () => {
		expect(getToolRenderer("subagent")).toBe(SubagentCard);
		expect(getToolRenderer("subagent_wait")).toBe(SubagentCard);
		expect(getToolRenderer("contact_supervisor")).toBe(SubagentCard);
		expect(subagentSummary({ agent: "reviewer", task: "Inspect" })).toBe("reviewer · Inspect");
		expect(getToolSummary("subagent", props(undefined))).toBe("reviewer · Inspect the patch");
	});
});
