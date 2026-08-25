import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "../../tool-registry";
import { getToolRenderer, getToolSummary } from "../../tool-registry";
import { signetSummary } from "./register";
import { SignetCard, signetDetails } from "./signet-card";

const props = (result: unknown, status: ToolRenderProps["status"] = "done"): ToolRenderProps => ({
	toolCallId: "signet-call",
	toolName: "signet_recall",
	args: { query: "project decision" },
	result,
	status,
	streaming: false,
});

describe("Signet renderer parsing", () => {
	it("extracts bounded result metadata", () => {
		expect(signetDetails({ details: { memoriesFound: 2, error: "ignored" } })).toEqual({
			memoriesFound: 2,
			error: "ignored",
		});
	});

	it("renders offline memory availability without exposing raw diagnostics", () => {
		const markup = renderToStaticMarkup(
			<SignetCard
				{...props({
					content: [{ type: "text", text: "Signet daemon not running. Memories unavailable." }],
					details: { error: "daemon_offline" },
				})}
			/>,
		);
		expect(markup).toContain("Signet daemon unavailable");
		expect(markup).not.toContain("Memories unavailable.");
	});

	it("escapes saved memory text and shows a running state", () => {
		const running = renderToStaticMarkup(<SignetCard {...props(undefined, "running")} />);
		expect(running).toContain("Recalling memory");
		const markup = renderToStaticMarkup(
			<SignetCard
				{...props({ content: [{ type: "text", text: '<script>alert("x")</script>' }] })}
			/>,
		);
		expect(markup).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
		expect(markup).not.toContain("<script>");
	});
});

describe("Signet renderer registration", () => {
	it("registers all connector tool names with query summaries", () => {
		for (const name of [
			"signet_recall",
			"signet_source_search",
			"signet_session_search",
			"signet_remember",
		]) {
			expect(getToolRenderer(name)).toBe(SignetCard);
		}
		expect(signetSummary({ query: "remember this" })).toBe("remember this");
		expect(getToolSummary("signet_recall", props(undefined))).toBe("project decision");
	});
});
