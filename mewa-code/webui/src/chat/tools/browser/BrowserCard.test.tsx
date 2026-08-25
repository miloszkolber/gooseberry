import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ToolRenderProps } from "../../toolRegistry";
import { getToolRenderer, getToolSummary } from "../../toolRegistry";
import { BrowserCard, browserArtifactUrl, browserDetails, browserImages } from "./BrowserCard";
import { browserSummary } from "./register";

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
});

describe("browser renderer registration", () => {
	it("registers the browser tool with a compact command/session summary", () => {
		expect(getToolRenderer("browser")).toBe(BrowserCard);
		expect(browserSummary({ command: "open", session: "qa" })).toBe("open in qa");
		expect(getToolSummary("browser", props(undefined))).toBe("snapshot in qa");
	});
});
