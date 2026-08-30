import { messagesToRuntime } from "../chat/hydrate";
import { errorText, getTransport } from "../connection";
import { chatTabId, toast, useAppStore } from "../store";

/** Open a session in the fixed editor strip. */
export async function openChatInTab(
	projectAreaId: string,
	sessionId: string,
	background = false,
): Promise<void> {
	const initial = useAppStore.getState();
	const requestConnectionGeneration =
		initial.status === "connected" ? initial.connectionGeneration : null;
	if (
		initial.removedProjectAreaIds[projectAreaId] ||
		initial.deletedSessionsByProjectArea[projectAreaId]?.[sessionId]
	) {
		return;
	}
	const options = background ? { activate: false } : undefined;
	const store = useAppStore.getState();
	const tab = (store.tabsByProjectArea[projectAreaId] ?? []).find(
		(t) => t.kind === "chat" && t.sessionId === sessionId,
	);
	if (tab) {
		store.openTab(tab, "keep", options);
		return;
	}
	if (store.sessions[sessionId]) {
		store.openTab(
			{
				kind: "chat",
				id: chatTabId(projectAreaId, sessionId),
				projectAreaId,
				name: "Chat",
				sessionId,
			},
			"keep",
			options,
		);
		return;
	}
	try {
		const { summary, messages } = await getTransport().request("session.getMessages", {
			sessionId,
			projectId: projectAreaId,
		});
		const current = useAppStore.getState();
		if (
			requestConnectionGeneration !== null &&
			current.connectionGeneration !== requestConnectionGeneration &&
			!current.removedProjectAreaIds[projectAreaId] &&
			!current.deletedSessionsByProjectArea[projectAreaId]?.[sessionId]
		) {
			return openChatInTab(projectAreaId, sessionId, background);
		}
		current.hydrateSession(
			summary,
			messagesToRuntime(messages, summary.lastSettlement),
			!background,
			undefined,
			options,
		);
		const settled = useAppStore.getState();
		const installed =
			settled.sessions[sessionId] !== undefined &&
			(settled.tabsByProjectArea[projectAreaId] ?? []).some(
				(tab) => tab.kind === "chat" && tab.sessionId === sessionId,
			);
		if (
			!installed &&
			!background &&
			!settled.removedProjectAreaIds[projectAreaId] &&
			!settled.deletedSessionsByProjectArea[projectAreaId]?.[sessionId]
		) {
			toast.error("The chat could not be restored.", "Couldn't open the chat");
		}
	} catch (err) {
		const current = useAppStore.getState();
		if (
			!background &&
			!current.removedProjectAreaIds[projectAreaId] &&
			!current.deletedSessionsByProjectArea[projectAreaId]?.[sessionId]
		) {
			toast.error(errorText(err), "Couldn't open the chat");
		}
	}
}
