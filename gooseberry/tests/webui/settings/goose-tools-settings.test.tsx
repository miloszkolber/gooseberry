import { beforeEach, expect, test } from "bun:test";
import type { AgentProfile, GooseToolSummary } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSettings } from "@/settings/sections/agent-settings";
import {
	ExtensionWarningCount,
	isSessionInventoryCurrent,
	ToolInventory,
} from "@/settings/sections/goose-tools-settings";
import { resolveSettingsSection, SettingsNavigation } from "@/settings/settings-dialog";
import { SettingsSection } from "@/settings/state";
import { useAppStore } from "@/store";

beforeEach(() => {
	useAppStore.setState({
		activeProjectAreaId: null,
		projectAreas: {},
		tabsByProjectArea: {},
		activeTabByProjectArea: {},
		settingsOpen: true,
		settingsSection: SettingsSection.Tools,
		agentProfile: null,
	});
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

test("generic agent settings expose agent identity, Signet and System", () => {
	const profile: AgentProfile = {
		name: "Example agent",
		version: "1.2.3",
		goose: false,
		compatible: true,
		missingRequired: [],
		operations: {
			deleteSession: false,
			forkSession: true,
			promptImage: false,
			httpMcp: false,
			steer: false,
			renameSession: false,
			archiveSession: false,
			administration: false,
		},
	};
	useAppStore.setState({ agentProfile: profile, settingsOpen: false });
	useAppStore.getState().openSettings();
	expect(useAppStore.getState().settingsSection).toBe(SettingsSection.Agent);
	const markup = renderToStaticMarkup(
		<>
			<SettingsNavigation section={SettingsSection.Agent} genericAgent />
			<AgentSettings profile={profile} />
		</>,
	);
	expect(markup).toContain(">Agent<");
	expect(markup).toContain(">Signet<");
	expect(markup).toContain(">System<");
	expect(markup).not.toContain(">Goose<");
	expect(markup).not.toContain(">Automation<");
	expect(markup).not.toContain(">Providers<");
	expect(markup).not.toContain(">Models<");
	expect(markup).not.toContain(">Tools<");
	expect(markup).toContain("Version 1.2.3");
	expect(markup).toContain("HTTP MCP servers");
	expect(resolveSettingsSection(SettingsSection.System, profile)).toBe(SettingsSection.System);
});

test("System remains reachable while agent capabilities are unavailable", () => {
	const markup = renderToStaticMarkup(
		<SettingsNavigation section={SettingsSection.System} profilePending />,
	);
	expect(resolveSettingsSection(SettingsSection.Tools, null)).toBe(SettingsSection.System);
	expect(markup).toContain(">System<");
	expect(markup).not.toContain(">Agent<");
	expect(markup).not.toContain(">Signet<");
	expect(markup).not.toContain(">Tools<");
});

test("settings tabs wrap without a native horizontal scroll container", () => {
	const markup = renderToStaticMarkup(
		<SettingsNavigation
			section={SettingsSection.Models}
			genericAgent={false}
			profilePending={false}
		/>,
	);
	expect(markup).toContain('role="tablist"');
	expect(markup).toContain("flex-wrap");
	expect(markup).not.toContain("overflow-x-auto");
});

test("session controls are current only after the active target finishes loading", () => {
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-a", false)).toBe(true);
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-b", false)).toBe(false);
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-a", true)).toBe(false);
});
