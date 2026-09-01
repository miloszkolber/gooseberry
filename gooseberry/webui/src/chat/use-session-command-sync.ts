import { useEffect } from "react";
import { getTransport } from "../connection";
import { selectSkillsStale, useAppStore } from "../store";

export function useSessionCommandSync(sessionId: string, projectAreaId: string): void {
	const sessionReady = useAppStore((state) => state.sessions[sessionId] !== undefined);
	const connectedGeneration = useAppStore((state) =>
		state.status === "connected" ? state.connectionGeneration : 0,
	);
	const commandCatalogGeneration = useAppStore((state) => state.commandCatalogGeneration);
	const skillVersion = useAppStore((state) =>
		selectSkillsStale(state, projectAreaId, sessionId)
			? (state.skillChangeTickByProjectArea[projectAreaId] ?? 0)
			: (state.skillsSyncedTickBySession[sessionId] ?? 0),
	);

	useEffect(() => {
		if (!sessionReady || connectedGeneration === 0) return;
		const startingState = useAppStore.getState();
		const syncedTick = startingState.skillChangeTickByProjectArea[projectAreaId] ?? 0;
		const commandRevision = startingState.sessions[sessionId]?.commandRevision ?? 0;
		const abort = new AbortController();
		getTransport()
			.request("session.getCommands", { sessionId }, { signal: abort.signal })
			.then((commands) => {
				if (abort.signal.aborted) return;
				const state = useAppStore.getState();
				const currentSkillVersion = selectSkillsStale(state, projectAreaId, sessionId)
					? (state.skillChangeTickByProjectArea[projectAreaId] ?? 0)
					: (state.skillsSyncedTickBySession[sessionId] ?? 0);
				if (
					state.status !== "connected" ||
					state.connectionGeneration !== connectedGeneration ||
					state.commandCatalogGeneration !== commandCatalogGeneration ||
					currentSkillVersion !== skillVersion
				)
					return;
				state.setCommands(sessionId, commands, commandRevision);
				state.markSkillsSynced(sessionId, syncedTick);
			})
			.catch(() => {});
		return () => abort.abort();
	}, [
		sessionId,
		projectAreaId,
		sessionReady,
		connectedGeneration,
		commandCatalogGeneration,
		skillVersion,
	]);
}
