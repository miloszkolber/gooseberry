import type { AgentProfile, AppConfig, PermissionRequest, Project } from "@gooseberry/contracts";
import { create } from "zustand";
import { type ChatState, createChatState } from "@/chat/state";
import { type ConnectionState, createConnectionState } from "@/connection/state";
import { createSettingsState, type SettingsState } from "@/settings/state";
import { createWorkspaceState, projectSnapshot, type WorkspaceState } from "@/workspace/state";

export { SettingsSection } from "@/settings/state";
export {
	EMPTY_RUNTIME,
	reduceSessionEvent,
	type SessionGoalRuntime,
	type SessionRuntime,
} from "../chat/session-runtime";
export {
	type ChatLocationRequest,
	type ChatTab,
	type ClosedChat,
	type ContentOpenOptions,
	type ContentTab,
	chatTabId,
	type DiffTab,
	type FileTab,
	type ProjectArea,
	type ProjectAreaActivity,
	projectArea,
	type RouteChatTarget,
	type TabIntent,
} from "../workspace/model";

export interface Toast {
	id: string;
	variant: "error" | "success" | "info";
	message: string;
	title?: string;
}
const MAX_TOASTS = 5;

export interface AppState extends WorkspaceState, ChatState, SettingsState, ConnectionState {
	toasts: Toast[];
	installWelcomeSnapshot: (
		protocolVersion: number,
		projects: Project[],
		recentProjects: Project[],
		config?: AppConfig,
		pendingPermissions?: PermissionRequest[],
		agentProfile?: AgentProfile,
	) => void;
	pushToast: (toast: Omit<Toast, "id">) => string;
	dismissToast: (id: string) => void;
}

function pendingPermissionSnapshot(
	requests: readonly PermissionRequest[],
): Record<string, Record<string, PermissionRequest>> {
	const pending: Record<string, Record<string, PermissionRequest>> = {};
	for (const request of requests) {
		pending[request.sessionId] = {
			...pending[request.sessionId],
			[request.id]: request,
		};
	}
	return pending;
}

export const useAppStore = create<AppState>((...args) => {
	const [set, get] = args;
	return {
		...createWorkspaceState(...args),
		...createChatState(...args),
		...createSettingsState(...args),
		...createConnectionState(...args),
		toasts: [],
		installWelcomeSnapshot: (
			protocolVersion,
			projects,
			recentProjects,
			config,
			pendingPermissions = [],
			agentProfile,
		) =>
			set((state) => ({
				...projectSnapshot(state, projects, recentProjects),
				protocolVersion,
				...(config ? { config } : {}),
				pendingPermissions: pendingPermissionSnapshot(pendingPermissions),
				agentProfile: agentProfile ?? null,
				welcomeGeneration: state.welcomeGeneration + 1,
			})),
		pushToast: (toast) => {
			const twin = get().toasts.find(
				(t) =>
					t.variant === toast.variant && t.title === toast.title && t.message === toast.message,
			);
			if (twin) return twin.id;
			const id = crypto.randomUUID();
			set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
			return id;
		},
		dismissToast: (id) =>
			set((s) =>
				s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : {},
			),
	};
});

export const toast = {
	error: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "error", message, ...(title ? { title } : {}) }),
	success: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "success", message, ...(title ? { title } : {}) }),
	info: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "info", message, ...(title ? { title } : {}) }),
};
