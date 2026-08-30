import { beforeEach, expect, test } from "bun:test";
import type { Project } from "@gooseberry/contracts";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { shallow } from "zustand/shallow";
import {
	EMPTY_RUNTIME,
	type ProjectArea,
	projectArea,
	SettingsSection,
	useAppStore,
} from "@/store";
import { hasConfiguredProvider, NoProviderWelcome } from "@/workspace/no-provider-welcome";
import { selectTabSessionStreaming } from "@/workspace/project-work-area";
import { ShellLayout } from "@/workspace/shell";

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

type ElementProps = { children?: ReactNode; [name: string]: unknown };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement(node)) return [];
	const element = node as ReactElement<ElementProps>;
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
			providers: [
				{ id: "p", name: "P", configured: true, acp: false, modelCount: 0, availableModelCount: 0 },
			],
		}),
	).toBeTrue();
});

test("desktop and narrow layouts share one mounted file and changes activity surface", () => {
	const markup = shellMarkup(true);
	expect(markup.match(/id="activity-panel"/g)).toHaveLength(1);
	expect(markup.match(/data-testid="tab-files"/g)).toHaveLength(1);
	expect(markup.match(/data-testid="tab-changes"/g)).toHaveLength(1);
	expect(markup).toContain('aria-label="Mobile panes"');
});

test("disconnection is explicit and sign-out appears only when controller authentication is enabled", () => {
	const disconnected = renderToStaticMarkup(
		<ShellLayout
			status="disconnected"
			availability="disconnected"
			providerConfigured={null}
			activeProjectAreaId={null}
			activeProjectArea={null}
			contextProject={null}
			authenticationEnabled
		/>,
	);
	expect(disconnected).toContain("Controller disconnected");
	expect(disconnected).toContain('aria-label="Sign out"');

	const local = renderToStaticMarkup(
		<ShellLayout
			status="disconnected"
			availability="disconnected"
			providerConfigured={null}
			activeProjectAreaId={null}
			activeProjectArea={null}
			contextProject={null}
		/>,
	);
	expect(local).not.toContain('aria-label="Sign out"');
});

test("workspace subscriptions ignore chat content but retain streaming and runtime availability", () => {
	useAppStore.setState({
		tabsByProjectArea: {
			[area.id]: [
				{ kind: "chat", id: "tab", projectAreaId: area.id, name: "Chat", sessionId: "open" },
			],
		},
		sessions: { open: { ...EMPTY_RUNTIME }, background: { ...EMPTY_RUNTIME } },
	});
	let selected = selectTabSessionStreaming(useAppStore.getState(), area.id);
	let updates = 0;
	// Use the same comparison as the workspace's useShallow subscription.
	const unsubscribe = useAppStore.subscribe((state) => {
		const next = selectTabSessionStreaming(state, area.id);
		if (!shallow(selected, next)) {
			selected = next;
			updates += 1;
		}
	});
	try {
		expect(selected).toEqual({ open: false });
		useAppStore.getState().handleAgentEvent({ type: "run-start" }, "open");
		expect(selected).toEqual({ open: true });
		expect(updates).toBe(1);
		for (let index = 0; index < 100; index += 1) {
			useAppStore.getState().handleAgentEvent({ type: "text", text: "." }, "open");
			useAppStore.getState().handleAgentEvent({ type: "text", text: "." }, "background");
		}
		expect(updates).toBe(1);
		useAppStore.getState().handleAgentEvent({ type: "complete" }, "open");
		expect(selected).toEqual({ open: false });
		expect(updates).toBe(2);
		useAppStore.getState().closeChatRuntime("open");
		expect(selected).toEqual({});
		expect(updates).toBe(3);
		useAppStore.setState((state) => ({
			sessions: { ...state.sessions, open: { ...EMPTY_RUNTIME } },
		}));
		expect(selected).toEqual({ open: false });
		expect(updates).toBe(4);
	} finally {
		unsubscribe();
	}
});
