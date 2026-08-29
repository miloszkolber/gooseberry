import { beforeEach, expect, test } from "bun:test";
import type { GooseToolSummary } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsSection, useAppStore } from "@/store";
import {
	ExtensionWarningCount,
	GooseToolsSettings,
	isSessionInventoryCurrent,
	ToolInventory,
} from "./goose-tools-settings";
import { SettingsNavigation } from "./settings-dialog";

beforeEach(() => {
	useAppStore.setState({
		activeProjectAreaId: null,
		projectAreas: {},
		tabsByProjectArea: {},
		activeTabByProjectArea: {},
		settingsOpen: true,
		settingsSection: SettingsSection.Tools,
	});
});

test("tools settings explains global Goose ownership when no chat is active", () => {
	const markup = renderToStaticMarkup(<GooseToolsSettings />);
	expect(markup).toContain(
		"Goose owns global extension configuration and global tool permissions.",
	);
	expect(markup).toContain("Open a chat in the current project");
});

test("tool inventory renders an accessible global-permission control", () => {
	const tool: GooseToolSummary = {
		name: "developer__shell",
		description: "Run a command",
		parameters: ["command"],
		permission: "ask_before",
	};
	const markup = renderToStaticMarkup(
		<ToolInventory tool={tool} busy={false} onPermissionChange={async () => {}} />,
	);
	expect(markup).toContain('aria-label="Permission for developer__shell"');
	expect(markup).toContain("Always allow");
	expect(markup).toContain("Ask first");
	expect(markup).toContain("Never allow");
	expect(markup).toContain("Goose default");
	expect(markup).toContain('value="ask_before"');
	expect(markup).toContain('selected=""');
});

test("an omitted permission displays Goose default and warning counts do not expose warning text", () => {
	const tool: GooseToolSummary = {
		name: "developer__shell",
		description: "Run a command",
		parameters: [],
	};
	const inventory = renderToStaticMarkup(
		<ToolInventory tool={tool} busy={false} onPermissionChange={async () => {}} />,
	);
	const warnings = renderToStaticMarkup(<ExtensionWarningCount warningCount={2} />);
	expect(inventory).toContain('value="goose_default"');
	expect(inventory).toContain('disabled=""');
	expect(inventory).toContain('selected=""');
	expect(inventory).toContain("Goose default");
	expect(warnings).toContain("2 Goose configuration warnings reported.");
	expect(warnings).not.toContain("warning text");
});

test("settings navigation exposes the Tools tab and scrolls on narrow screens", () => {
	const markup = renderToStaticMarkup(<SettingsNavigation section={SettingsSection.Tools} />);
	expect(markup).toContain(">Tools<");
	expect(markup).toContain('aria-label="Settings"');
	expect(markup).toContain("overflow-x-auto");
});

test("session controls are current only after the active target finishes loading", () => {
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-a", false)).toBe(true);
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-b", false)).toBe(false);
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-a", true)).toBe(false);
});
