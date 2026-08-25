import type {
	ProjectFsChangedPayload,
	ProjectWatchReadyResult,
	WsParams,
	WsResult,
} from "@mewa-code/contracts";
import { selectProjectAreaTick, useAppStore } from "../store";
import { getTransport } from "./wire-transport";

export interface SkillLoadDependencies {
	watchReady: (projectId: string, prewarm: boolean) => Promise<ProjectWatchReadyResult>;
	noteFsChanged: (payload: ProjectFsChangedPayload) => void;
	projectAreaTick: (projectAreaId: string) => number;
	createSession: (params: WsParams<"session.create">) => Promise<WsResult<"session.create">>;
	getSessionMessages: (
		params: WsParams<"session.getMessages">,
	) => Promise<WsResult<"session.getMessages">>;
	reloadSessionResources: (
		params: WsParams<"session.reloadResources">,
	) => Promise<WsResult<"session.reloadResources">>;
}

export function createSkillLoadRequests(deps: SkillLoadDependencies) {
	const pending = new Map<string, { preparation: Promise<number>; prewarm: boolean }>();

	const prepare = (projectAreaId: string, prewarm: boolean): Promise<number> => {
		const existing = pending.get(projectAreaId);
		if (existing && (prewarm || !existing.prewarm)) return existing.preparation;

		const started = deps.watchReady(projectAreaId, prewarm).then(({ startupNudge }) => {
			if (startupNudge) {
				deps.noteFsChanged({
					projectId: projectAreaId,
					paths: [],
					truncated: true,
				});
			}
			return deps.projectAreaTick(projectAreaId);
		});
		const preparation = started.finally(() => {
			if (pending.get(projectAreaId)?.preparation === preparation) pending.delete(projectAreaId);
		});
		pending.set(projectAreaId, { preparation, prewarm });
		return preparation;
	};

	return {
		async prewarmProjectAreaSkillLoad(projectAreaId: string): Promise<void> {
			await prepare(projectAreaId, true);
		},
		async createSession(params: WsParams<"session.create">) {
			const syncedTick = await prepare(params.projectId, false);
			const result = await deps.createSession(params);
			return { result, syncedTick };
		},
		async getSessionMessages(params: WsParams<"session.getMessages">) {
			const syncedTick = await prepare(params.projectId, false);
			const result = await deps.getSessionMessages(params);
			if (
				result.summary.projectId !== params.projectId ||
				result.summary.sessionId !== params.sessionId
			) {
				throw new Error("Session response did not match the requested projectArea and session");
			}
			return { result, syncedTick };
		},
		async reloadSessionResources(
			projectAreaId: string,
			params: WsParams<"session.reloadResources">,
		) {
			const syncedTick = await prepare(projectAreaId, false);
			const result = await deps.reloadSessionResources(params);
			return { result, syncedTick };
		},
	};
}

const skillLoadRequests = createSkillLoadRequests({
	watchReady: (projectId, prewarm) =>
		getTransport().request(
			"project.watchReady",
			prewarm ? { projectId, prewarm: true } : { projectId },
		),
	noteFsChanged: (payload) => useAppStore.getState().noteFsChanged(payload),
	projectAreaTick: (projectAreaId) => selectProjectAreaTick(useAppStore.getState(), projectAreaId),
	createSession: (params) => getTransport().request("session.create", params),
	getSessionMessages: (params) => getTransport().request("session.getMessages", params),
	reloadSessionResources: (params) => getTransport().request("session.reloadResources", params),
});

export const prewarmProjectAreaSkillLoad = skillLoadRequests.prewarmProjectAreaSkillLoad;
export const createSessionWithSkillBaseline = skillLoadRequests.createSession;
export const getSessionMessagesWithSkillBaseline = skillLoadRequests.getSessionMessages;
export const reloadSessionResourcesWithSkillBaseline = skillLoadRequests.reloadSessionResources;
