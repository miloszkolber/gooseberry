import type { Workspace } from "@mewa-code/contracts";
import {
	selectCurrentRouteChatTarget,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	useAppStore,
} from "../store";
import type { NavigationDriver } from "./driver";
import { type NavigationLocation, parseFragment, serializeLocation } from "./location";

export interface NavigationDeps {
	driver: NavigationDriver;
	listWorkspaces: (projectId: string) => Promise<Workspace[]>;
}

export function deriveLocation(state: {
	activeWorkspaceId: string | null;
	selectedProjectId: string | null;
	workspaces: Record<string, Workspace[]>;
	tabsByWorkspace: Record<string, { id: string; kind: string; sessionId?: string }[]>;
	activeTabByWorkspace: Record<string, string | null>;
}): NavigationLocation | null {
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) {
		const workspace = selectWorkspaceById(state, workspaceId);
		if (!workspace) return null;
		const activeId = state.activeTabByWorkspace[workspaceId];
		const active = (state.tabsByWorkspace[workspaceId] ?? []).find((tab) => tab.id === activeId);
		if (active?.kind === "chat" && active.sessionId) {
			return {
				kind: "chat",
				projectId: workspace.projectId,
				workspaceId,
				sessionId: active.sessionId,
			};
		}
		return { kind: "workspace", projectId: workspace.projectId, workspaceId };
	}
	if (state.selectedProjectId) return { kind: "project", projectId: state.selectedProjectId };
	return { kind: "main" };
}

interface NavigationIntentState {
	selectedProjectId: string | null;
	activeWorkspaceId: string | null;
	navTickByWorkspace: Record<string, number>;
}

function isUserNavigationEdge(
	state: NavigationIntentState,
	previous: NavigationIntentState,
): boolean {
	if (state.selectedProjectId !== previous.selectedProjectId) return true;
	if (state.activeWorkspaceId !== previous.activeWorkspaceId) return true;
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return false;
	return selectWorkspaceNavTick(state, workspaceId) > selectWorkspaceNavTick(previous, workspaceId);
}

export function startNavigation({ driver, listWorkspaces }: NavigationDeps): () => void {
	let generation = 0;
	let pending: { generation: number; location: NavigationLocation } | null = null;
	const attempting = new Set<number>();
	let lastWritten = "";
	let armedPush = false;
	let applyingRoute = false;

	const applyRoute = (write: () => void) => {
		applyingRoute = true;
		try {
			write();
		} finally {
			applyingRoute = false;
		}
	};

	const syncNow = () => {
		if (pending) return;
		const state = useAppStore.getState();
		if (state.routeChatTarget) return;
		const location = deriveLocation(state);
		if (!location) return;
		const fragment = serializeLocation(location);
		if (fragment === lastWritten) return;
		if (armedPush) driver.push(fragment);
		else driver.replace(fragment);
		armedPush = false;
		lastWritten = fragment;
	};

	const resolvePending = (gen: number) => {
		if (pending?.generation === gen) pending = null;
		syncNow();
	};

	const attempt = async (gen: number) => {
		if (pending?.generation !== gen || attempting.has(gen)) return;
		const location = pending.location;
		if (location.kind === "main") {
			applyRoute(() => useAppStore.getState().selectMain());
			resolvePending(gen);
			return;
		}
		const state = useAppStore.getState();
		if (state.welcomeGeneration === 0) return;
		if (!state.projects.some((p) => p.id === location.projectId)) {
			applyRoute(() => useAppStore.getState().selectMain());
			resolvePending(gen);
			return;
		}
		if (location.kind === "project") {
			applyRoute(() => useAppStore.getState().selectProject(location.projectId));
			resolvePending(gen);
			return;
		}
		attempting.add(gen);
		let rows: Workspace[];
		try {
			rows = await listWorkspaces(location.projectId);
		} catch {
			attempting.delete(gen);
			return;
		}
		attempting.delete(gen);
		if (pending?.generation !== gen) return;
		const now = useAppStore.getState();
		if (!now.projects.some((p) => p.id === location.projectId)) {
			applyRoute(() => useAppStore.getState().selectMain());
			resolvePending(gen);
			return;
		}
		applyRoute(() => now.setWorkspaces(location.projectId, rows));
		const workspace = rows.find((w) => w.id === location.workspaceId);
		if (!workspace) {
			applyRoute(() => useAppStore.getState().selectProject(location.projectId));
			resolvePending(gen);
			return;
		}
		applyRoute(() =>
			useAppStore
				.getState()
				.activateWorkspaceFromRoute(
					workspace,
					location.kind === "chat" ? location.sessionId : undefined,
				),
		);
		resolvePending(gen);
	};

	const acceptFragment = (fragment: string) => {
		const location = parseFragment(fragment);
		generation += 1;
		pending = { generation, location };
		armedPush = false;
		applyRoute(() => {
			const state = useAppStore.getState();
			if (state.activeWorkspaceId) state.noteNavigation(state.activeWorkspaceId);
			useAppStore.getState().clearRouteChatTarget();
		});
		const canonical = serializeLocation(location);
		if (canonical !== fragment) driver.replace(canonical);
		lastWritten = canonical;
		void attempt(generation);
	};

	const unsubscribeDriver = driver.onIncoming(acceptFragment);
	const unsubscribeStore = useAppStore.subscribe((state, previous) => {
		if (!applyingRoute && isUserNavigationEdge(state, previous)) {
			armedPush = true;
		}
		if (
			!applyingRoute &&
			pending &&
			(state.selectedProjectId !== previous.selectedProjectId ||
				state.activeWorkspaceId !== previous.activeWorkspaceId ||
				state.navTickByWorkspace !== previous.navTickByWorkspace)
		) {
			pending = null;
		}
		if (state.welcomeGeneration !== previous.welcomeGeneration && pending) {
			void attempt(pending.generation);
		}
		if (state.routeChatTarget && !selectCurrentRouteChatTarget(state)) {
			state.clearRouteChatTarget();
			return;
		}
		syncNow();
	});

	acceptFragment(driver.read());

	return () => {
		unsubscribeDriver();
		unsubscribeStore();
		pending = null;
	};
}
