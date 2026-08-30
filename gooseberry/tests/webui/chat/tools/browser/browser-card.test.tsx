import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "@/chat/tool-registry";
import { getToolRenderer, getToolSummary } from "@/chat/tool-registry";
import {
	BrowserCard,
	browserArtifactUrl,
	browserDetails,
	browserImages,
} from "@/chat/tools/browser/browser-card";
import { browserSummary } from "@/chat/tools/browser/register";

const props = (result: unknown, status: ToolRenderProps["status"] = "done"): ToolRenderProps => ({
	toolCallId: "browser-call",
	toolName: "browser",
	args: { command: "snapshot", session: "qa" },
	result,
	status,
	streaming: false,
});

describe("browser renderer parsing", () => {
	it("extracts text, image, and guarded artifact details", () => {
		const result = {
			content: [
				{ type: "text", text: "snapshot output" },
				{ type: "image", data: "iVBORw==", mimeType: "image/png" },
				{ type: "image", data: "<svg>", mimeType: "image/svg+xml" },
			],
			details: {
				session: "qa",
				command: "screenshot",
				artifact: { name: "screen.png", url: "/v1/artifacts/qa/screen.png" },
			},
		};
		expect(browserDetails(result)).toEqual({
			session: "qa",
			command: "screenshot",
			artifact: { name: "screen.png", url: "/v1/artifacts/qa/screen.png" },
		});
		expect(browserImages(result)).toHaveLength(1);
		expect(browserArtifactUrl("/v1/artifacts/qa/screen.png")).toBe("/v1/artifacts/qa/screen.png");
		expect(browserArtifactUrl("/v1/artifacts/qa/screen.png?token=secret")).toBeUndefined();
		expect(browserArtifactUrl("https://evil.example/screen.png")).toBeUndefined();
	});

	it("renders failures and screenshots as safe text and image elements", () => {
		const markup = renderToStaticMarkup(
			<BrowserCard
				{...props(
					{
						content: [{ type: "text", text: '<script>alert("x")</script>' }],
					},
					"error",
				)}
			/>,
		);
		expect(markup).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
		expect(markup).not.toContain("<script>");

		const screenshot = renderToStaticMarkup(
			<BrowserCard
				{...props({
					content: [{ type: "image", data: "iVBORw==", mimeType: "image/png" }],
					details: { artifact: "screen.png" },
				})}
			/>,
		);
		expect(screenshot).toContain('data-testid="tool-browser-images"');
		expect(screenshot).toContain("data:image/png;base64,iVBORw==");
		expect(screenshot).toContain("Artifact:");
	});

	it("shows a bounded running state even before a result arrives", () => {
		const markup = renderToStaticMarkup(<BrowserCard {...props(undefined, "running")} />);
		expect(markup).toContain("Running browser command");
	});

	it("preserves MCP screenshot details through structured results and ACP text replay", () => {
		const payload = {
			outcome: "completed",
			command: "screenshot",
			session: "qa",
			code: 0,
			stdout: "Screenshot saved",
			stderr: "",
			artifact: { name: "screen.png", url: "/v1/artifacts/qa/screen.png" },
		};
		const text = { type: "text", text: JSON.stringify(payload) };
		for (const result of [
			{ structuredContent: payload, content: [text] },
			{ content: [text] },
			[{ type: "content", content: text }],
		]) {
			expect(browserDetails(result).artifact).toEqual(payload.artifact);
			const markup = renderToStaticMarkup(<BrowserCard {...props(result)} />);
			expect(markup).toContain('href="/v1/artifacts/qa/screen.png"');
			expect(markup).toContain("Screenshot saved");
			expect(markup).not.toContain("&quot;outcome&quot;");
		}
		const failed = renderToStaticMarkup(
			<BrowserCard
				{...props({
					structuredContent: {
						outcome: "rejected",
						warnings: ["Invalid command"],
						hints: ["Read browser guidance"],
					},
				})}
			/>,
		);
		expect(failed).toContain("Invalid command");
		expect(failed).toContain("Read browser guidance");
		expect(failed).toContain("text-feedback-error");
	});
});

describe("browser renderer registration", () => {
	it("registers the browser tool with a compact command/session summary", () => {
		expect(getToolRenderer("browser")).toBe(BrowserCard);
		expect(getToolRenderer("gooseberry_browser__browser_command")).toBe(BrowserCard);
		expect(getToolRenderer("private_browser__browser_command")).toBe(BrowserCard);
		expect(browserSummary({ command: "open", session: "qa" })).toBe("open in qa");
		expect(getToolSummary("browser", props(undefined))).toBe("snapshot in qa");
		expect(getToolSummary("private_browser__browser_command", props(undefined))).toBe(
			"snapshot in qa",
		);
	});
});
