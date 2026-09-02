import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messagesToRuntime } from "@/chat/hydrate";
import { deriveRows } from "@/chat/rows";
import { createSessionRuntime, reduceSessionEvent } from "@/chat/session-runtime";
import { DefaultToolRenderer, getToolRenderer, type ToolRenderProps } from "@/chat/tool-registry";
import { McpAppSessionProvider } from "@/chat/tools/apps/mcp-app-context";
import {
	canOpenMcpApp,
	MCP_APP_IFRAME_SANDBOX,
	McpAppView,
	mcpAppPermissionLabels,
	toMcpToolResult,
} from "@/chat/tools/apps/mcp-app-view";
import { BashCard } from "@/chat/tools/bash-card";
import { EditCard } from "@/chat/tools/edit-card";
import { resultText } from "@/chat/tools/tool-helpers";
import "@/chat/tools/register";

const props = (
	toolName: string,
	result: unknown,
	args: Record<string, unknown> = {},
): ToolRenderProps => ({
	toolCallId: "builtin-tool",
	toolName,
	args,
	result,
	status: "done",
	streaming: false,
});

test("generic builtin output preserves ordered text, image and resource blocks without executing HTML", () => {
	const blocks = [
		{ type: "text", text: "Loaded image" },
		{ type: "image", mimeType: "image/png", data: "YWJjZA==" },
		{
			type: "resource",
			resource: {
				uri: "ui://apps/example",
				mimeType: "text/html;profile=mcp-app",
				text: "<script>unsafe()</script>",
			},
		},
		{ type: "future-output", value: "kept for compatibility" },
	];
	for (const result of [
		blocks,
		{ content: blocks },
		{
			structuredContent: { path: "/repo/image.png", width: 12 },
			content: blocks.map((content) => ({ type: "content", content })),
		},
	]) {
		const markup = renderToStaticMarkup(
			<DefaultToolRenderer {...props("read_image", result)} status="running" />,
		);
		expect(markup).toContain("Loaded image");
		expect(markup).toContain("chat-attachment-chip");
		expect(markup).not.toContain("YWJjZA==");
		expect(markup).toContain("ui://apps/example");
		expect(markup).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
		expect(markup).not.toContain("<script");
		expect(markup).not.toContain("<iframe");
		expect(markup).toContain("kept for compatibility");
		expect(markup.indexOf("Loaded image")).toBeLessThan(markup.indexOf("chat-attachment-chip"));
	}
	expect(
		renderToStaticMarkup(
			<DefaultToolRenderer
				{...props("orchestrator__view_session", {
					content: [],
					structuredContent: { status: "done" },
				})}
			/>,
		),
	).toContain("done");
	const failure = {
		structuredContent: { error: "permission denied" },
		content: blocks.slice(0, 2),
	};
	for (const Renderer of [DefaultToolRenderer, BashCard]) {
		const markup = renderToStaticMarkup(<Renderer {...props("shell", failure)} status="error" />);
		expect(markup).toContain("permission denied");
		expect(markup).toContain("Loaded image");
		if (Renderer === DefaultToolRenderer) expect(markup).toContain("chat-attachment-chip");
	}
});

test("Apps creation and iteration keep their concise saved state", () => {
	for (const toolName of ["apps__create_app", "apps__iterate_app"]) {
		const markup = renderToStaticMarkup(
			<DefaultToolRenderer {...props(toolName, "Opened in a new window")} />,
		);
		expect(markup).toContain("Opened in a new window");
		expect(markup).toContain("App saved in Goose");
		expect(markup).not.toContain("not supported");
	}
	for (const toolName of ["apps__list_apps", "other__create_app"]) {
		expect(
			renderToStaticMarkup(<DefaultToolRenderer {...props(toolName, "Result")} />),
		).not.toContain("App saved");
	}
	expect(
		renderToStaticMarkup(
			<DefaultToolRenderer {...props("apps__create_app", "Failed")} status="error" />,
		),
	).not.toContain("App saved");
});

test("settled session-bound MCP Apps preserve errors and declared permission labels", () => {
	const app = {
		toolName: "weather",
		extensionName: "weather-server",
		resourceUri: "ui://weather/dashboard",
	};
	expect(canOpenMcpApp(app, "done")).toBe(true);
	expect(canOpenMcpApp(app, "error")).toBe(true);
	expect(canOpenMcpApp(app, "running")).toBe(false);
	expect(canOpenMcpApp({ ...app, resourceUri: "https://unsafe.example" }, "done")).toBe(false);
	expect(MCP_APP_IFRAME_SANDBOX).toBe("allow-scripts allow-same-origin allow-forms");
	expect(
		mcpAppPermissionLabels({
			clipboardWrite: {},
			camera: {},
			geolocation: {},
		}),
	).toEqual(["Camera", "Location", "Clipboard write"]);

	const view = (
		<McpAppView
			toolCallId="tool-1"
			args={{ city: "Warsaw" }}
			result={{ content: [{ type: "text", text: "Clear" }] }}
			app={app}
			status="done"
		/>
	);
	expect(renderToStaticMarkup(view)).not.toContain("Open app");
	expect(
		renderToStaticMarkup(
			<McpAppSessionProvider projectId="project-1" sessionId="session-1">
				{view}
			</McpAppSessionProvider>,
		),
	).toContain("Open app");
	expect(toMcpToolResult("legacy result")).toEqual({
		content: [{ type: "text", text: "legacy result" }],
	});
	expect(
		toMcpToolResult({ content: [{ type: "text", text: "MCP result" }], isError: true }),
	).toEqual({ content: [{ type: "text", text: "MCP result" }], isError: true });
	expect(toMcpToolResult([{ type: "text", text: "Failed" }], true)).toEqual({
		content: [{ type: "text", text: "Failed" }],
		isError: true,
	});
	expect(
		renderToStaticMarkup(
			<McpAppSessionProvider projectId="project-1" sessionId="session-1">
				<McpAppView
					toolCallId="tool-error"
					args={{ city: "Warsaw" }}
					result={[{ type: "text", text: "Provider failed" }]}
					app={app}
					status="error"
				/>
			</McpAppSessionProvider>,
		),
	).toContain("Open app");
});

test("official developer and summon results use their real arguments and show returned output", () => {
	expect(getToolRenderer("shell")).toBe(BashCard);
	expect(getToolRenderer("third_party__shell")).toBe(DefaultToolRenderer);
	const shellResult = [
		{ type: "text", text: "stdout" },
		{ type: "text", text: "stderr" },
	];
	expect(resultText(shellResult)).toBe("stdout\nstderr");
	const edit = renderToStaticMarkup(
		<EditCard
			{...props("edit", "Updated file", {
				path: "/repo/file.ts",
				before: "old value",
				after: "new value",
			})}
		/>,
	);
	expect(edit).toContain("old value");
	expect(edit).toContain("new value");
	expect(edit).toContain("Updated file");
	for (const toolName of ["delegate", "load"]) {
		const Renderer = getToolRenderer(toolName);
		const returned = renderToStaticMarkup(
			<Renderer
				{...props(toolName, { content: [{ type: "text", text: "Actual Goose result" }] })}
			/>,
		);
		expect(returned).toContain("Actual Goose result");
		expect(returned).not.toContain("Subagent running");
		const failed = renderToStaticMarkup(
			<Renderer
				{...props(toolName, { content: [{ type: "text", text: "Actual Goose failure" }] })}
				status="error"
			/>,
		);
		expect(failed).toContain("Actual Goose failure");
		expect(failed).toContain("text-feedback-error");
	}
	const replay = messagesToRuntime([
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "summon-call",
					toolName: "summon__delegate",
					name: "delegate",
					arguments: {},
				},
			],
		},
	]);
	const activity = deriveRows(replay.turns, replay.toolResults, false).find(
		(row) => row.kind === "activity",
	);
	const projected = activity?.kind === "activity" ? activity.steps[0] : undefined;
	expect(projected?.kind === "tool" ? projected.toolName : undefined).toBe("summon__delegate");
});

test("status-only tool completion retains the right streamed result and matches history hydration", () => {
	const image = [{ type: "image", mimeType: "image/png", data: "YWJjZA==" }];
	const subagentActivity = {
		events: [{ childSessionId: "child-1", toolName: "shell" }],
		truncated: true,
	};
	const app = {
		toolName: "read_image",
		extensionName: "images",
		resourceUri: "ui://images/viewer",
	};
	const pending = messagesToRuntime([], {
		pendingTools: [{ toolCallId: "image", output: image, app, subagentActivity }],
	});
	expect(pending.toolResults.image).toEqual({
		status: "running",
		raw: image,
		app,
		subagentActivity,
	});
	const precedence = messagesToRuntime(
		[
			{ role: "toolResult", toolCallId: "image", content: "completed" },
			{ role: "toolResult", toolCallId: "__proto__", content: "safe", isError: true },
			{ role: "toolResult", toolCallId: "without-output", content: "old result" },
			{
				role: "assistant",
				content: [
					{ type: "toolCall", id: "image", name: "image", arguments: {} },
					{ type: "toolCall", id: "__proto__", name: "reserved", arguments: {} },
					{ type: "toolCall", id: "without-output", name: "read", arguments: {} },
				],
			},
		],
		{
			pendingTools: [
				{ toolCallId: "image", output: "current pending output" },
				{ toolCallId: "__proto__", output: "current reserved output" },
				{ toolCallId: "toString", output: "still running" },
			],
		},
	);
	expect(Object.getPrototypeOf(precedence.toolResults)).toBeNull();
	expect(precedence.toolResults.image).toEqual({
		status: "running",
		raw: "current pending output",
	});
	expect(Reflect.get(precedence.toolResults, "__proto__")).toEqual({
		status: "running",
		raw: "current reserved output",
	});
	expect(Reflect.get(precedence.toolResults, "toString")).toEqual({
		status: "running",
		raw: "still running",
	});
	expect(Object.hasOwn(precedence.toolResults, "without-output")).toBe(false);
	let reloaded = createSessionRuntime(null, "off");
	reloaded = { ...reloaded, ...pending };
	reloaded = reduceSessionEvent(reloaded, {
		type: "tool-end",
		toolCallId: "image",
		status: "completed",
	});
	expect(reloaded.toolResults.image).toEqual({
		status: "done",
		raw: image,
		app,
		subagentActivity,
	});
	let runtime = createSessionRuntime(null, "off");
	runtime = reduceSessionEvent(runtime, {
		type: "tool-start",
		toolCallId: "image",
		toolName: "read_image",
		tool: { path: "/repo/image.png" },
	});
	expect(runtime.toolResults.image?.raw).toBeUndefined();
	runtime = reduceSessionEvent(runtime, {
		type: "tool-update",
		toolCallId: "image",
		tool: image,
		app,
		subagentActivity,
	});
	runtime = reduceSessionEvent(runtime, {
		type: "tool-update",
		toolCallId: "other",
		tool: "other result",
	});
	runtime = reduceSessionEvent(runtime, {
		type: "tool-end",
		toolCallId: "image",
		status: "completed",
	});
	const history = messagesToRuntime([
		{ role: "toolResult", toolCallId: "image", content: image, app, subagentActivity },
	]);
	expect(runtime.toolResults.image).toEqual(history.toolResults.image);
	expect(runtime.toolResults.other?.raw).toBe("other result");
	for (const tool of ["", false]) {
		runtime = reduceSessionEvent(runtime, {
			type: "tool-end",
			toolCallId: "image",
			status: "completed",
			tool,
		});
		expect(runtime.toolResults.image?.raw).toBe(tool);
	}
});
