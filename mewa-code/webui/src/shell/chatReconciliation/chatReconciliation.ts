import { useEffect, useRef } from "react";
import { messagesToRuntime } from "../../chat/hydrate";
import { tupleKey } from "../../lib";
import {
	type ChatTab,
	chatTabId,
	isConnectedGeneration,
	selectWorkspaceSessionIds,
	toast,
	useAppStore,
} from "../../store";
import { errorText, getSessionMessagesWithSkillBaseline, getTransport } from "../../transport";

const sessionHydration = new Map<string, Promise<boolean>>();
const AUTO_OPEN_CHAT_LIMIT = 4;

function chatTab(
	state: ReturnType<typeof useAppStore.getState>,
	workspaceId: string,
	sessionId: string,
) {
	return (state.tabsByWorkspace[workspaceId] ?? []).find(
		(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === sessionId,
	);
}

export function hydrateChatResource(workspaceId: string, sessionId: string): Promise<boolean> {
	const state = useAppStore.getState();
	if (
		state.removedWorkspaceIds[workspaceId] ||
		state.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
	) {
		return Promise.resolve(false);
	}
	if (state.sessions[sessionId] && chatTab(state, workspaceId, sessionId))
		return Promise.resolve(true);
	const generation = state.connectionGeneration;
	const key = tupleKey("chat-hydration", workspaceId, sessionId, String(generation));
	const existing = sessionHydration.get(key);
	if (existing) return existing;
	const request = getSessionMessagesWithSkillBaseline({ workspaceId, sessionId })
		.then(({ result: { summary, messages }, syncedTick }) => {
			const current = useAppStore.getState();
			if (!isConnectedGeneration(current, generation)) return false;
			if (
				current.removedWorkspaceIds[workspaceId] ||
				current.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
			) {
				return false;
			}
			current.hydrateSession(
				summary,
				messagesToRuntime(messages, summary.lastSettlement),
				false,
				summary.live ? undefined : syncedTick,
				{ activate: false },
			);
			const installed = useAppStore.getState();
			return (
				installed.sessions[sessionId] !== undefined &&
				chatTab(installed, workspaceId, sessionId) !== undefined
			);
		})
		.finally(() => sessionHydration.delete(key));
	sessionHydration.set(key, request);
	return request;
}

export function currentChatDestination(workspaceId: string, tab: ChatTab, _navigation?: unknown) {
	const state = useAppStore.getState();
	return {
		state,
		current:
			state.activeWorkspaceId === workspaceId && state.activeTabByWorkspace[workspaceId] === tab.id,
	};
}

/** Kept as a hook boundary for callers while deleted sessions are pruned from editor tabs directly. */
export function useDeletedChatPlacementReconciliation(_workspaceId: string): void {}

export function useWorkspaceChatCatalogReconciliation(workspaceId: string): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const routeTargetGeneration = useAppStore((state) => state.routeChatTargetGeneration);
	const routeTarget = useAppStore((state) => {
		const target = state.routeChatTarget;
		return target?.workspaceId === workspaceId ? target : null;
	});
	const flight = useRef(0);

	useEffect(() => {
		void routeTargetGeneration;
		if (status !== "connected" || connectionGeneration === 0) return;
		const run = ++flight.current;
		const baseline = selectWorkspaceSessionIds(useAppStore.getState(), workspaceId);
		let current = true;
		const live = () =>
			current &&
			flight.current === run &&
			isConnectedGeneration(useAppStore.getState(), connectionGeneration) &&
			!useAppStore.getState().removedWorkspaceIds[workspaceId];

		void getTransport()
			.request("session.list", { workspaceId })
			.then(async (summaries) => {
				if (!live()) return;
				useAppStore.getState().reconcileWorkspaceSessions(
					workspaceId,
					baseline,
					summaries.map((summary) => summary.sessionId),
				);
				const targetSummary = routeTarget
					? summaries.find((summary) => summary.sessionId === routeTarget.sessionId)
					: undefined;
				if (routeTarget && targetSummary) {
					useAppStore.getState().validateRouteChatTarget(routeTarget.sessionId);
					const targetTab = chatTab(useAppStore.getState(), workspaceId, routeTarget.sessionId);
					if (targetTab) {
						useAppStore.getState().setActiveTab(targetTab.id, "keep");
					} else {
						const loaded = await getSessionMessagesWithSkillBaseline({
							workspaceId,
							sessionId: routeTarget.sessionId,
						});
						if (!live()) return;
						const loadedState = useAppStore.getState();
						loadedState.hydrateSession(
							loaded.result.summary,
							messagesToRuntime(loaded.result.messages, loaded.result.summary.lastSettlement),
							false,
							loaded.result.summary.live ? undefined : loaded.syncedTick,
							{ activate: false },
						);
						const hydratedTab = chatTab(useAppStore.getState(), workspaceId, routeTarget.sessionId);
						if (hydratedTab) useAppStore.getState().setActiveTab(hydratedTab.id, "keep");
					}
					useAppStore.getState().clearRouteChatTarget();
				}

				const openTabs = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
				const openSessions = new Set(
					openTabs.filter((tab) => tab.kind === "chat").map((tab) => tab.sessionId),
				);
				const toOpen = summaries
					.filter(
						(summary) =>
							summary.live &&
							!openSessions.has(summary.sessionId) &&
							summary.sessionId !== routeTarget?.sessionId,
					)
					.sort((a, b) => b.updatedAt - a.updatedAt)
					.slice(0, AUTO_OPEN_CHAT_LIMIT);
				const history = summaries.filter(
					(summary) => !summary.live && !openSessions.has(summary.sessionId),
				);
				let activated = Boolean(routeTarget);
				for (const summary of toOpen) {
					const loaded = await getSessionMessagesWithSkillBaseline({
						workspaceId,
						sessionId: summary.sessionId,
					});
					if (!live()) return;
					const state = useAppStore.getState();
					state.hydrateSession(
						loaded.result.summary,
						messagesToRuntime(loaded.result.messages, loaded.result.summary.lastSettlement),
						false,
						loaded.result.summary.live ? undefined : loaded.syncedTick,
						{ activate: false },
					);
					const tab = chatTab(useAppStore.getState(), workspaceId, summary.sessionId);
					if (tab && !activated) {
						useAppStore.getState().setActiveTab(tab.id, "keep");
						activated = true;
					}
				}
				if (history.length > 0 && live()) {
					useAppStore.getState().noteClosedChats(
						workspaceId,
						history.map((summary) => ({
							sessionId: summary.sessionId,
							title: summary.title,
							closedAt: summary.updatedAt,
						})),
					);
				}
			})
			.catch((error: unknown) => {
				if (live()) toast.error(errorText(error), "Couldn't load this workspace's chats");
			});
		return () => {
			current = false;
		};
	}, [connectionGeneration, routeTarget, routeTargetGeneration, status, workspaceId]);
}

export function useChatLocationReconciliation(workspaceId: string): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const request = useAppStore((state) => state.chatLocationRequest);

	useEffect(() => {
		if (!request || request.workspaceId !== workspaceId) return;
		const state = useAppStore.getState();
		const existing = chatTab(state, workspaceId, request.sessionId);
		if (existing) {
			state.setActiveTab(existing.id, "keep");
			state.clearChatLocation();
			return;
		}
		if (state.sessions[request.sessionId]) {
			const title =
				state.closedChatsByWorkspace[workspaceId]?.find(
					(chat) => chat.sessionId === request.sessionId,
				)?.title ?? "Chat";
			state.openTab(
				{
					kind: "chat",
					id: chatTabId(workspaceId, request.sessionId),
					workspaceId,
					name: title,
					sessionId: request.sessionId,
				},
				"keep",
			);
			state.clearChatLocation();
			return;
		}
		if (status !== "connected" || !isConnectedGeneration(state, connectionGeneration)) return;
		let current = true;
		void hydrateChatResource(workspaceId, request.sessionId)
			.then((installed) => {
				if (!current) return;
				const latest = useAppStore.getState();
				if (installed) {
					const tab = chatTab(latest, workspaceId, request.sessionId);
					if (tab) latest.setActiveTab(tab.id, "keep");
				} else if (
					!latest.removedWorkspaceIds[workspaceId] &&
					!latest.deletedSessionsByWorkspace[workspaceId]?.[request.sessionId]
				) {
					toast.error("The chat could not be restored.", "Couldn't open the chat");
				}
				if (latest.chatLocationRequest === request) latest.clearChatLocation();
			})
			.catch((error) => {
				if (current) toast.error(errorText(error), "Couldn't open the chat");
				const latest = useAppStore.getState();
				if (latest.chatLocationRequest === request) latest.clearChatLocation();
			});
		return () => {
			current = false;
		};
	}, [connectionGeneration, request, status, workspaceId]);
}
