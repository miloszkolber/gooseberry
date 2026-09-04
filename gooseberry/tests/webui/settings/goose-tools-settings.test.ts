import { beforeEach, expect, test } from "bun:test";
import type { AgentProfile, GooseToolSummary } from "@gooseberry/contracts";
import { agentOperationRows } from "@/settings/sections/agent-settings";
import {
	extensionWarningText,
	isSessionInventoryCurrent,
	permissionLabel,
} from "@/settings/sections/goose-tools-settings";
import { resolveSettingsSection, settingsTabs } from "@/settings/settings-dialog";
import { SettingsSection } from "@/settings/state";
import { appStoreApi } from "@/store";

beforeEach(() => {
	appStoreApi.setState({
		activeProjectAreaId: null,
		projectAreas: {},
		tabsByProjectArea: {},
		activeTabByProjectArea: {},
		settingsOpen: true,
		settingsSection: SettingsSection.Tools,
		agentProfile: null,
	});
});

test("tool inventory retains every global-permission choice and its accessible control", async () => {
	const tool: GooseToolSummary = {
		name: "developer__shell",
		description: "Run a command",
		parameters: ["command"],
		permission: "ask_before",
	};
	const source = await Bun.file(
		new URL("../../../webui/src/settings/sections/goose-tools-settings.svelte", import.meta.url),
	).text();

	expect(permissionLabel).toEqual({
		always_allow: "Always allow",
		ask_before: "Ask first",
		never_allow: "Never allow",
	});
	expect(permissionLabel[tool.permission ?? "ask_before"]).toBe("Ask first");
	expect(source).toMatch(/aria-label=\{`Permission for \$\{tool\.name\}`\}/);
	expect(source).toContain('value={tool.permission ?? "goose_default"}');
	expect(source).toContain('<option value="goose_default" disabled>Goose default</option>');
});

test("omitted permissions use Goose default and warning counts never expose warning text", () => {
	expect(extensionWarningText(0)).toBeNull();
	expect(extensionWarningText(1)).toBe("1 Goose configuration warning reported.");
	expect(extensionWarningText(2)).toBe("2 Goose configuration warnings reported.");
	expect(extensionWarningText(2)).not.toContain("warning text");
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
			promptEmbeddedContext: false,
			httpMcp: false,
			steer: false,
			renameSession: false,
			archiveSession: false,
			administration: false,
		},
	};
	appStoreApi.setState({ agentProfile: profile, settingsOpen: false });
	appStoreApi.getState().openSettings();
	expect(appStoreApi.getState().settingsSection).toBe(SettingsSection.Agent);
	expect(settingsTabs(true, false).map(({ label }) => label)).toEqual([
		"Agent",
		"Signet",
		"System",
	]);
	expect(settingsTabs(true, false).map(({ label }) => label)).not.toContain("Goose");
	expect(agentOperationRows(profile)).toContainEqual({
		operation: "httpMcp",
		label: "HTTP MCP servers",
		available: false,
	});
	expect(resolveSettingsSection(SettingsSection.System, profile)).toBe(SettingsSection.System);
});

test("System remains reachable while agent capabilities are unavailable", () => {
	expect(resolveSettingsSection(SettingsSection.Tools, null)).toBe(SettingsSection.System);
	expect(settingsTabs(false, true)).toEqual([{ section: SettingsSection.System, label: "System" }]);
});

test("settings tabs wrap without a native horizontal scroll container", async () => {
	const source = await Bun.file(
		new URL("../../../webui/src/settings/settings-dialog.svelte", import.meta.url),
	).text();
	expect(source).toContain('role="tablist"');
	expect(source).toContain("flex-wrap");
	expect(source).not.toContain("overflow-x-auto");
	expect(source).toContain('role="tabpanel"');
});

test("session controls are current only after the active target finishes loading", () => {
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-a", false)).toBe(true);
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-b", false)).toBe(false);
	expect(isSessionInventoryCurrent("project-a\0chat-a", "project-a\0chat-a", true)).toBe(false);
});
