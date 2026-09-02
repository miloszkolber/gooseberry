import type {
	AgentProfile,
	AppConfig,
	LoginPush,
	PermissionRequest,
	PermissionResolvedPayload,
	Project,
	ProjectFsChangedPayload,
	ServerWelcome,
	SessionDeletedPayload,
	SessionEventPayload,
	SessionGoal,
	SessionLifecycleChangedPayload,
} from "@gooseberry/contracts";
import { WS_CHANNELS } from "@gooseberry/contracts";
import { useAppStore } from "../store";
import { WsTransport } from "./transport";

let transport: WsTransport | null = null;

export function initTransport(): WsTransport {
	if (transport) return transport;

	transport = new WsTransport({
		onStatus: (status) => useAppStore.getState().setStatus(status),
		onAuthenticationLoss: () => window.dispatchEvent(new Event("gooseberry-auth-lost")),
		isAuthenticated: async () => {
			try {
				const response = await fetch("/auth/status", {
					credentials: "same-origin",
					cache: "no-store",
				});
				if (!response.ok) return false;
				const status = (await response.json()) as { authenticated?: unknown };
				return status.authenticated === true;
			} catch {
				return true;
			}
		},
	});

	transport.subscribe(WS_CHANNELS.serverWelcome, (data) => {
		const welcome = data as Partial<ServerWelcome>;
		if (typeof welcome.protocolVersion !== "number" || !Array.isArray(welcome.projects)) return;
		useAppStore
			.getState()
			.installWelcomeSnapshot(
				welcome.protocolVersion,
				welcome.projects,
				Array.isArray(welcome.recentProjects) ? welcome.recentProjects : welcome.projects,
				welcome.config,
				Array.isArray(welcome.pendingPermissions) ? welcome.pendingPermissions : [],
				welcome.agentProfile,
			);
	});
	transport.subscribe(WS_CHANNELS.agentProfileChanged, (data) => {
		useAppStore.getState().replaceAgentProfile(data as AgentProfile);
	});

	transport.subscribe(WS_CHANNELS.projectUpdated, (data) => {
		useAppStore.getState().applyProjectUpdated(data as Project);
	});

	transport.subscribe(WS_CHANNELS.agentEvent, (data) => {
		const { sessionId, event } = data as SessionEventPayload;
		useAppStore.getState().handleAgentEvent(event, sessionId);
	});

	transport.subscribe(WS_CHANNELS.permissionRequest, (data) => {
		useAppStore.getState().setPendingPermission(data as PermissionRequest);
	});
	transport.subscribe(WS_CHANNELS.permissionResolved, (data) => {
		const payload = data as PermissionResolvedPayload;
		useAppStore.getState().clearPendingPermission(payload.sessionId, payload.permissionId);
	});

	transport.subscribe(WS_CHANNELS.sessionDeleted, (data) => {
		const { projectId, sessionId } = data as SessionDeletedPayload;
		useAppStore.getState().deleteChat(projectId, sessionId, false);
	});
	transport.subscribe(WS_CHANNELS.sessionLifecycleChanged, (data) => {
		useAppStore.getState().applySessionLifecycle(data as SessionLifecycleChangedPayload);
	});
	transport.subscribe(WS_CHANNELS.sessionObjectiveChanged, (data) => {
		const objective = data as SessionGoal;
		useAppStore.getState().setSessionGoal(objective.sessionId, objective);
	});

	transport.subscribe(WS_CHANNELS.projectFsChanged, (data) => {
		useAppStore.getState().noteFsChanged(data as ProjectFsChangedPayload);
	});
	transport.subscribe(WS_CHANNELS.commandCatalogChanged, () => {
		useAppStore.getState().noteCommandCatalogChanged();
	});

	transport.subscribe(WS_CHANNELS.settingsChanged, (data) => {
		useAppStore.getState().applyConfig(data as AppConfig);
	});

	transport.subscribe(WS_CHANNELS.providerLogin, (data) => {
		useAppStore.getState().applyLoginFrame(data as LoginPush);
	});

	transport.connect();
	return transport;
}

export function getTransport(): WsTransport {
	if (!transport) throw new Error("transport not initialized — call initTransport() first");
	return transport;
}

export function resetTransport(): void {
	transport?.stop();
	transport = null;
}
