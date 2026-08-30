import { useEffect, useRef } from "react";
import { messagesToRuntime } from "../chat/hydrate";
import { errorText, getTransport } from "../connection";
import { tupleKey } from "../lib";
import {
	type ChatTab,
	type ClosedChat,
	chatTabId,
	isConnectedGeneration,
	selectProjectAreaById,
	selectProjectAreaSessionIds,
	toast,
	useAppStore,
} from "../store";

const sessionHydration = new Map<
	string,
	{ promise: Promise<boolean>; closedChat: ClosedChat | undefined }
>();
const AUTO_OPEN_CHAT_LIMIT = 4;

function chatTab(
	state: ReturnType<typeof useAppStore.getState>,
	projectAreaId: string,
	sessionId: string,
) {
	return (state.tabsByProjectArea[projectAreaId] ?? []).find(
		(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === sessionId,
	);
}

export function hydrateChatResource(projectAreaId: string, sessionId: string): Promise<boolean> {
	const state = useAppStore.getState();
	const projectId = selectProjectAreaById(state, projectAreaId)?.projectId ?? projectAreaId;
	if (
		!state.projects.some((project) => project.id === projectId) ||
		state.removedProjectAreaIds[projectAreaId] ||
		state.deletedSessionsByProjectArea[projectAreaId]?.[sessionId]
	) {
		return Promise.resolve(false);
	}
	const closedChat = state.closedChatsByProjectArea[projectAreaId]?.find(
		(chat) => chat.sessionId === sessionId,
	);
	if (state.sessions[sessionId]) {
		if (!chatTab(state, projectAreaId, sessionId)) {
			state.openTab(
				{
					kind: "chat",
					id: chatTabId(projectAreaId, sessionId),
					projectAreaId,
					name: closedChat?.title ?? "Chat",
					sessionId,
				},
				"keep",
				{ activate: false },
			);
		}
		return Promise.resolve(true);
	}
	const generation = state.connectionGeneration;
	const key = tupleKey("chat-hydration", projectAreaId, sessionId, String(generation));
	const existing = sessionHydration.get(key);
	if (existing && existing.closedChat === closedChat) return existing.promise;
	const request = getTransport()
		.request("session.getMessages", { projectId: projectAreaId, sessionId })
		.then(({ summary, messages }) => {
			const current = useAppStore.getState();
			if (!isConnectedGeneration(current, generation)) return false;
			if (
				!current.projects.some((project) => project.id === projectId) ||
				current.closedChatsByProjectArea[projectAreaId]?.find(
					(chat) => chat.sessionId === sessionId,
				) !== closedChat ||
				current.removedProjectAreaIds[projectAreaId] ||
				current.deletedSessionsByProjectArea[projectAreaId]?.[sessionId]
			) {
				return false;
			}
			current.hydrateSession(
				summary,
				messagesToRuntime(messages, summary.lastSettlement),
				false,
				undefined,
				{ activate: false },
			);
			const installed = useAppStore.getState();
			return (
				installed.sessions[sessionId] !== undefined &&
				chatTab(installed, projectAreaId, sessionId) !== undefined
			);
		})
		.finally(() => {
			if (sessionHydration.get(key)?.promise === request) sessionHydration.delete(key);
		});
	sessionHydration.set(key, { promise: request, closedChat });
	return request;
}

export function useProjectAreaChatCatalogReconciliation(projectAreaId: string): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const catalogVersion = useAppStore(
		(state) => state.sessionCatalogVersionByProjectArea[projectAreaId] ?? 0,
	);
	const routeTargetGeneration = useAppStore((state) => state.routeChatTargetGeneration);
	const routeTarget = useAppStore((state) => {
		const target = state.routeChatTarget;
		return target?.projectAreaId === projectAreaId ? target : null;
	});
	const flight = useRef(0);

	useEffect(() => {
		void routeTargetGeneration;
		void catalogVersion;
		if (status !== "connected" || connectionGeneration === 0) return;
		const run = ++flight.current;
		const baseline = selectProjectAreaSessionIds(useAppStore.getState(), projectAreaId);
		let current = true;
		const live = () =>
			current &&
			flight.current === run &&
			isConnectedGeneration(useAppStore.getState(), connectionGeneration) &&
			!useAppStore.getState().removedProjectAreaIds[projectAreaId];

		void getTransport()
			.request("session.list", { projectId: projectAreaId, archived: "all" })
			.then(async (catalog) => {
				if (!live()) return;
				const summaries = catalog.filter((summary) => !summary.archived);
				useAppStore.getState().reconcileProjectAreaSessions(projectAreaId, baseline, catalog);
				const targetSummary = routeTarget
					? summaries.find((summary) => summary.sessionId === routeTarget.sessionId)
					: undefined;
				if (routeTarget && targetSummary) {
					useAppStore.getState().validateRouteChatTarget(routeTarget.sessionId);
					const targetTab = chatTab(useAppStore.getState(), projectAreaId, routeTarget.sessionId);
					if (targetTab) {
						useAppStore.getState().setActiveTab(targetTab.id, "keep");
					} else {
						await hydrateChatResource(projectAreaId, routeTarget.sessionId);
						if (!live()) return;
						const hydratedTab = chatTab(
							useAppStore.getState(),
							projectAreaId,
							routeTarget.sessionId,
						);
						if (hydratedTab) useAppStore.getState().setActiveTab(hydratedTab.id, "keep");
					}
					useAppStore.getState().clearRouteChatTarget();
				}

				const openTabs = useAppStore.getState().tabsByProjectArea[projectAreaId] ?? [];
				const openSessions = new Set(
					openTabs.filter((tab) => tab.kind === "chat").map((tab) => tab.sessionId),
				);
				const closedSessions = new Set(
					(useAppStore.getState().closedChatsByProjectArea[projectAreaId] ?? []).map(
						(chat) => chat.sessionId,
					),
				);
				const toOpen = summaries
					.filter(
						(summary) =>
							summary.live &&
							!openSessions.has(summary.sessionId) &&
							!closedSessions.has(summary.sessionId) &&
							summary.sessionId !== routeTarget?.sessionId,
					)
					.sort((a, b) => b.updatedAt - a.updatedAt)
					.slice(0, AUTO_OPEN_CHAT_LIMIT);
				const history = summaries.filter(
					(summary) => !summary.live && !openSessions.has(summary.sessionId),
				);
				let activated = Boolean(routeTarget);
				for (const summary of toOpen) {
					// A retained projection can still be live after the user closes its tab.
					// Catalog refresh must not turn that close into an automatic reopen.
					if (
						useAppStore
							.getState()
							.closedChatsByProjectArea[projectAreaId]?.some(
								(chat) => chat.sessionId === summary.sessionId,
							)
					) {
						continue;
					}
					await hydrateChatResource(projectAreaId, summary.sessionId);
					if (!live()) return;
					const tab = chatTab(useAppStore.getState(), projectAreaId, summary.sessionId);
					if (tab && !activated) {
						useAppStore.getState().setActiveTab(tab.id, "keep");
						activated = true;
					}
				}
				if (history.length > 0 && live()) {
					useAppStore.getState().noteClosedChats(
						projectAreaId,
						history.map((summary) => ({
							sessionId: summary.sessionId,
							title: summary.title,
							closedAt: summary.updatedAt,
						})),
					);
				}
			})
			.catch((error: unknown) => {
				if (live()) toast.error(errorText(error), "Couldn't load this projectArea's chats");
			});
		return () => {
			current = false;
		};
	}, [
		catalogVersion,
		connectionGeneration,
		routeTarget,
		routeTargetGeneration,
		status,
		projectAreaId,
	]);
}

export function useChatLocationReconciliation(projectAreaId: string): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const request = useAppStore((state) => state.chatLocationRequest);

	useEffect(() => {
		if (!request || request.projectAreaId !== projectAreaId) return;
		const state = useAppStore.getState();
		const existing = chatTab(state, projectAreaId, request.sessionId);
		if (existing) {
			state.setActiveTab(existing.id, "keep");
			state.clearChatLocation();
			return;
		}
		if (state.sessions[request.sessionId]) {
			const title =
				state.closedChatsByProjectArea[projectAreaId]?.find(
					(chat) => chat.sessionId === request.sessionId,
				)?.title ?? "Chat";
			state.openTab(
				{
					kind: "chat",
					id: chatTabId(projectAreaId, request.sessionId),
					projectAreaId,
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
		void hydrateChatResource(projectAreaId, request.sessionId)
			.then((installed) => {
				if (!current) return;
				const latest = useAppStore.getState();
				if (installed) {
					const tab = chatTab(latest, projectAreaId, request.sessionId);
					if (tab) latest.setActiveTab(tab.id, "keep");
				} else if (
					!latest.removedProjectAreaIds[projectAreaId] &&
					!latest.deletedSessionsByProjectArea[projectAreaId]?.[request.sessionId]
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
	}, [connectionGeneration, request, status, projectAreaId]);
}
