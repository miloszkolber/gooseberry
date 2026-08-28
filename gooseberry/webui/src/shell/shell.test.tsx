import { beforeEach, expect, test } from "bun:test";
import type { Project } from "@gooseberry/contracts";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasConfiguredProvider, NoProviderWelcome } from "../panels/no-provider-welcome";
import { type ProjectArea, projectArea, SettingsSection, useAppStore } from "../store";
import { ShellLayout } from "./shell";

const project: Project = {
	id: "project-1",
	name: "Existing project",
	roots: ["/projects/existing"],
	slug: "existing-project",
	lastOpened: 1,
};

const area: ProjectArea = projectArea(project);

beforeEach(() => {
	useAppStore.setState({
		status: "connected",
		projects: [project],
		recentProjects: [project],
		projectAreas: { [project.id]: [area] },
		selectedProjectId: project.id,
		activeProjectAreaId: area.id,
		providerConfigured: null,
		settingsOpen: false,
		settingsSection: SettingsSection.Models,
	});
});

function shellMarkup(providerConfigured: boolean | null): string {
	return renderToStaticMarkup(
		<ShellLayout
			status="connected"
			providerConfigured={providerConfigured}
			activeProjectAreaId={area.id}
			activeProjectArea={area}
			contextProject={project}
		/>,
	);
}

function elements(node: ReactNode): ReactElement[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement(node)) return [];
	const element = node as ReactElement<{ children?: ReactNode }>;
	return [element, ...elements(element.props.children)];
}

function text(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join("");
	if (!isValidElement(node)) return "";
	return text((node as ReactElement<{ children?: ReactNode }>).props.children);
}

function expectBlockedShell(markup: string): void {
	expect(markup).not.toContain('data-testid="left-nav"');
	expect(markup).not.toContain('data-testid="project-shell"');
	expect(markup).not.toContain('data-testid="project-work-area"');
	expect(markup).not.toContain('data-testid="activity-tabs"');
	expect(markup).not.toContain("Open project");
	expect(markup).not.toContain("Continue project");
}

test("Shell keeps projects and hotkey targets inaccessible while provider status is loading", () => {
	const markup = shellMarkup(null);
	expect(markup).toContain('data-testid="provider-status-loading"');
	expectBlockedShell(markup);
});

test("Shell replaces existing project UI with provider setup when no provider is configured", () => {
	const markup = shellMarkup(false);
	expect(markup).toContain('data-testid="no-provider-welcome"');
	expect(markup).toContain("Goose unavailable");
	expect(markup).toContain("View Goose providers");
	expectBlockedShell(markup);

	const layout = ShellLayout({
		status: "connected",
		providerConfigured: false,
		activeProjectAreaId: area.id,
		activeProjectArea: area,
		contextProject: project,
	});
	const welcome = elements(layout).find((element) => element.type === NoProviderWelcome);
	if (!welcome) throw new Error("no-provider welcome missing from Shell layout");
	const connect = elements((welcome.type as typeof NoProviderWelcome)()).find(
		(element) => text(element.props.children) === "View Goose providers",
	);
	if (!connect) throw new Error("Goose provider button missing");
	(connect.props.onClick as () => void)();
	expect(useAppStore.getState().settingsOpen).toBeTrue();
	expect(useAppStore.getState().settingsSection).toBe(SettingsSection.Providers);
});

test("provider configuration reflects the status report", () => {
	expect(hasConfiguredProvider({ providers: [] })).toBeFalse();
	expect(
		hasConfiguredProvider({
			providers: [{ id: "p", name: "P", configured: true, modelCount: 0, availableModelCount: 0 }],
		}),
	).toBeTrue();
});
