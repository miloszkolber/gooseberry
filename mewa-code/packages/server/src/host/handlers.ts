import type {
	AppConfigPatch,
	AskUserQuestionResult,
	ExtUiResponse,
	GitDiffScope,
	HistoryScope,
	ImageContent,
	LoginReply,
	QueueLane,
	ThinkingLevel,
	WireModel,
	Workspace,
} from "@mewa-code/contracts";
import {
	abortSession,
	answerQuestion,
	clampThinkingForModel,
	clearQueueSession,
	compactSession,
	createSession,
	deleteSession,
	ensureSessionAttached,
	followUpSession,
	getDefaultModel,
	getPiProfile,
	getSessionCommands,
	getSessionMessages,
	getSessionStats,
	getSessionWorkspaceId,
	hasSession,
	listAvailableModels,
	listSessions,
	listSkillCatalog,
	listSkillCommands,
	promptSession,
	refreshAvailableModels,
	reloadSessionResources,
	removeQueuedSession,
	removeWorkspaceSessions,
	resolveExtUi,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
} from "../agent";
import { cancelLogin, getProviderStatus, logoutProvider, resolveLogin, startLogin } from "../auth";
import { selectDirectory } from "../dialog";
import { listAvailableEditors, openEditor, revealInFileManager } from "../editors";
import { readDir, readFile, writeFile } from "../fs";
import { gitDiffFile, gitStatus, listBranches, listCommits, prefetchBranch } from "../git";
import { clampLimit, getHistoryIndex } from "../history";
import { clearStoredSessionGoal, sessionGoalState, writeStoredSessionGoal } from "../persistence";
import {
	closeProject,
	listProjects,
	openProject,
	setProjectGroupEnabled,
	setProjectSkillEnabled,
	setProjectTrust,
} from "../projects";
import { updateConfig } from "../settings";
import { ensureWatch, stopWatch } from "../watch";
import {
	createWorkspace,
	ensureWorkspaceScratchDir,
	forgetWorkspace,
	getWorkspace,
	listExistingWorktrees,
	listWorkspaceRecords,
	listWorkspaces,
	openExistingWorktree,
	reclaimWorktree,
	setWorkspaceDiffBase,
	setWorkspaceSkillOverride,
	workspaceDiffStats,
} from "../workspaces";
import { ackSend } from "./ackSend";
import { nudgeBaseRefWorkspaces } from "./fsNudge";
import { buildHistoryScope } from "./historyScope";

export interface RequestContext {
	clientKey: string;
}

type Handler = (params: unknown, ctx: RequestContext) => unknown | Promise<unknown>;

async function archiveTeardown(ws: Workspace): Promise<void> {
	try {
		await removeWorkspaceSessions(ws.id, ws.worktreePath);
		reclaimWorktree(ws);
	} catch (error) {
		console.warn(`workspace archive teardown failed for ${ws.id}: ${error}`);
	}
}

async function authorizeSessionGoal(workspaceId: unknown, sessionId: unknown): Promise<void> {
	if (typeof workspaceId !== "string" || typeof sessionId !== "string") {
		throw new Error("Malformed session goal request");
	}
	const workspace = getWorkspace(workspaceId);
	const attached = await ensureSessionAttached(sessionId, workspaceId, workspace.worktreePath);
	if (!attached || getSessionWorkspaceId(sessionId) !== workspaceId) {
		throw new Error(`Unknown session: ${sessionId}`);
	}
}

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.list": () => listProjects(),
	"project.close": (params) => {
		closeProject((params as { id: string }).id);
		return { ok: true } as const;
	},
	"project.setTrust": async (params) => {
		const p = params as { id: string; trusted: boolean };
		const project = listProjects().find((candidate) => candidate.id === p.id);
		if (!project) throw new Error(`Unknown project: ${p.id}`);
		return setProjectTrust(p.id, p.trusted);
	},
	"workspace.create": (params) => {
		const p = params as { projectId: string; name?: string; baseRef?: string };
		return createWorkspace(p.projectId, p.name, p.baseRef);
	},
	"workspace.listExisting": (params) =>
		listExistingWorktrees((params as { projectId: string }).projectId),
	"workspace.openExisting": (params) => {
		const p = params as { projectId: string; path: string };
		return openExistingWorktree(p.projectId, p.path);
	},
	"workspace.list": (params) => {
		const p = params as { projectId: string; includeDiffStats?: boolean };
		return listWorkspaces(p.projectId, { includeDiffStats: p.includeDiffStats ?? true });
	},
	"workspace.remove": (params) => {
		const id = (params as { id: string }).id;
		const ws = forgetWorkspace(id);
		if (ws) {
			stopWatch(ws.id);
			void archiveTeardown(ws);
		}
		return { ok: true } as const;
	},
	"workspace.diffStats": (params) => workspaceDiffStats((params as { id: string }).id),
	"workspace.openIn": (params) => {
		const p = params as { id: string; editor: string };
		openEditor(p.editor, getWorkspace(p.id).worktreePath);
		return { ok: true } as const;
	},
	"workspace.reveal": (params) => {
		revealInFileManager(getWorkspace((params as { id: string }).id).worktreePath);
		return { ok: true } as const;
	},
	"editor.list": () => listAvailableEditors(),
	"git.listBranches": (params) => listBranches((params as { projectId: string }).projectId),
	"git.prefetch": async (params) => {
		const p = params as { projectId: string; ref: string };
		const { ok, moved } = await prefetchBranch(p.projectId, p.ref);
		if (moved) nudgeBaseRefWorkspaces(p.projectId, p.ref);
		return { ok };
	},
	"dialog.selectDirectory": () => selectDirectory(),
	"fs.readDir": (params) => {
		const p = params as { workspaceId: string; path: string };
		void ensureWatch(p.workspaceId);
		return readDir(p.workspaceId, p.path);
	},
	"fs.readFile": (params) => {
		const p = params as { workspaceId: string; path: string };
		void ensureWatch(p.workspaceId);
		return readFile(p.workspaceId, p.path);
	},
	"fs.writeFile": (params) => {
		const p = params as { workspaceId: string; path: string; content: string };
		void ensureWatch(p.workspaceId);
		writeFile(p.workspaceId, p.path, p.content);
		return { ok: true } as const;
	},
	"git.status": (params) => {
		const p = params as { workspaceId: string; scope?: GitDiffScope };
		void ensureWatch(p.workspaceId);
		return gitStatus(p.workspaceId, p.scope);
	},

	"git.diffFile": (params) => {
		const p = params as { workspaceId: string; path: string; scope?: GitDiffScope };
		void ensureWatch(p.workspaceId);
		return gitDiffFile(p.workspaceId, p.path, p.scope);
	},
	"git.listCommits": (params) => listCommits((params as { workspaceId: string }).workspaceId),
	"skill.list": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((candidate) => candidate.id === projectId);
		if (!project) throw new Error(`Unknown project: ${projectId}`);
		return listSkillCommands(project.path, {
			trusted: project.trusted === true,
			disabled: project.disabledSkills ?? [],
			disabledGroups: project.disabledGroups ?? [],
			overrides: {},
		});
	},
	"skills.state": (params) => {
		const { workspaceId } = params as { workspaceId: string };
		const ws = getWorkspace(workspaceId);
		const project = listProjects().find((p) => p.id === ws.projectId);
		return listSkillCatalog(ws.worktreePath, {
			trusted: project?.trusted === true,
			disabled: project?.disabledSkills ?? [],
			disabledGroups: project?.disabledGroups ?? [],
			overrides: ws.skillOverrides ?? {},
		});
	},
	"project.setSkillEnabled": (params) => {
		const p = params as { id: string; name: string; enabled: boolean };
		return setProjectSkillEnabled(p.id, p.name, p.enabled);
	},
	"project.setGroupEnabled": (params) => {
		const p = params as { id: string; group: string; enabled: boolean };
		return setProjectGroupEnabled(p.id, p.group, p.enabled);
	},
	"project.skills": (params) => {
		const { projectId } = params as { projectId: string };
		const project = listProjects().find((p) => p.id === projectId);
		if (!project) throw new Error(`Unknown project: ${projectId}`);
		return listSkillCatalog(project.path, {
			trusted: project.trusted === true,
			disabled: project.disabledSkills ?? [],
			disabledGroups: project.disabledGroups ?? [],
			overrides: {},
		});
	},
	"workspace.setSkillOverride": (params) => {
		const p = params as { id: string; name: string; override: "on" | "off" | null };
		return setWorkspaceSkillOverride(p.id, p.name, p.override);
	},
	"workspace.setDiffBase": (params) => {
		const p = params as { id: string; ref: string | null };
		return setWorkspaceDiffBase(p.id, p.ref);
	},
	"workspace.watchReady": (params) => {
		const p = params as { workspaceId: string; prewarm?: boolean };
		return ensureWatch(p.workspaceId, { prewarm: p.prewarm === true });
	},
	"session.reloadResources": async (params) => {
		await reloadSessionResources((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.create": async (params) => {
		const p = params as {
			workspaceId: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		const ws = getWorkspace(p.workspaceId);
		ensureWorkspaceScratchDir(ws);
		const created = await createSession({
			cwd: ws.worktreePath,
			workspaceId: p.workspaceId,
			...(p.model ? { model: p.model } : {}),
			...(p.thinkingLevel ? { thinkingLevel: p.thinkingLevel } : {}),
		});
		return created;
	},
	"session.prompt": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(promptSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.steer": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(steerSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.followUp": async (params) => {
		const p = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(followUpSession(p.sessionId, p.text, p.images));
		return { ok: true } as const;
	},
	"session.clearQueue": (params) => {
		return clearQueueSession((params as { sessionId: string }).sessionId);
	},
	"session.removeQueued": async (params) => {
		const p = params as { sessionId: string; kind: QueueLane; index: number };
		return removeQueuedSession(p.sessionId, p.kind, p.index);
	},
	"session.abort": async (params) => {
		await abortSession((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.delete": async (params) => {
		const p = params as { workspaceId: string; sessionId: string };
		await deleteSession(p.sessionId, p.workspaceId, getWorkspace(p.workspaceId).worktreePath);
		return { ok: true } as const;
	},
	"session.setModel": async (params) => {
		const p = params as { sessionId: string; model: WireModel };
		await setSessionModel(p.sessionId, p.model);
		return { ok: true } as const;
	},
	"session.setThinkingLevel": (params) => {
		const p = params as { sessionId: string; level: ThinkingLevel };
		setSessionThinkingLevel(p.sessionId, p.level);
		return { ok: true } as const;
	},
	"session.compact": async (params) => {
		const p = params as { sessionId: string; instructions?: string };
		await compactSession(p.sessionId, p.instructions);
		return { ok: true } as const;
	},
	"session.getStats": (params) => getSessionStats((params as { sessionId: string }).sessionId),
	"session.getCommands": (params) =>
		getSessionCommands((params as { sessionId: string }).sessionId),
	"session.list": async (params) => {
		const { workspaceId } = params as { workspaceId: string };
		return listSessions(workspaceId, getWorkspace(workspaceId).worktreePath);
	},
	"session.getMessages": (params) => {
		const p = params as { sessionId: string; workspaceId: string };
		return getSessionMessages(p.sessionId, p.workspaceId, getWorkspace(p.workspaceId).worktreePath);
	},
	"session.extUiReply": (params) => {
		resolveExtUi((params as { response: ExtUiResponse }).response);
		return { ok: true } as const;
	},
	"session.answerQuestion": async (params) => {
		const p = params as { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		if (!hasSession(p.sessionId)) throw new Error(`Unknown session: ${p.sessionId}`);
		if (!p.result || !Array.isArray(p.result.answers) || typeof p.result.cancelled !== "boolean")
			throw new Error("Malformed ask_user_question result");
		await ackSend(answerQuestion(p.sessionId, p.toolCallId, p.result));
		return { ok: true } as const;
	},
	"session.goalGet": async (params) => {
		const p = params as { workspaceId?: unknown; sessionId?: unknown };
		await authorizeSessionGoal(p.workspaceId, p.sessionId);
		return sessionGoalState(p.workspaceId as string, p.sessionId as string);
	},
	"session.goalSet": async (params) => {
		const p = params as { workspaceId?: unknown; sessionId?: unknown; goal?: unknown };
		await authorizeSessionGoal(p.workspaceId, p.sessionId);
		writeStoredSessionGoal(p.workspaceId as string, p.sessionId as string, p.goal);
		return sessionGoalState(p.workspaceId as string, p.sessionId as string);
	},
	"session.goalClear": async (params) => {
		const p = params as { workspaceId?: unknown; sessionId?: unknown };
		await authorizeSessionGoal(p.workspaceId, p.sessionId);
		clearStoredSessionGoal(p.workspaceId as string, p.sessionId as string);
		return sessionGoalState(p.workspaceId as string, p.sessionId as string);
	},
	"model.list": () => listAvailableModels(),
	"model.clampThinking": async (params) => {
		const p = params as { provider: string; id: string; level: ThinkingLevel };
		return { level: await clampThinkingForModel({ provider: p.provider, id: p.id }, p.level) };
	},
	"model.refresh": (params) => {
		const p = params as { force?: boolean };
		return refreshAvailableModels(p.force === true);
	},
	"model.default": () => getDefaultModel(),
	"provider.status": () => getProviderStatus(),
	"provider.loginStart": (params) => {
		const p = params as { providerId: string; type?: "oauth" | "api_key" };
		const type = p.type ?? "oauth";
		return startLogin(p.providerId, type);
	},
	"provider.loginReply": (params) => {
		resolveLogin(params as LoginReply);
		return { ok: true } as const;
	},
	"provider.loginCancel": (params) => {
		const { loginId } = params as { loginId: string };
		cancelLogin(loginId);
		return { ok: true } as const;
	},
	"provider.logout": async (params) => {
		await logoutProvider((params as { providerId: string }).providerId);
		return { ok: true } as const;
	},
	"settings.profile": () => getPiProfile(),
	"settings.update": (params) => {
		const config = (params as { config: AppConfigPatch }).config;
		return updateConfig(config);
	},
	"history.search": (params) => {
		const p = params as { query: string; scope: HistoryScope; limit?: number };
		const { filter, labels } = buildHistoryScope(p.scope, listProjects(), (projectId) =>
			listWorkspaceRecords(projectId),
		);
		return getHistoryIndex().search({
			query: p.query,
			filter,
			labels,
			limit: clampLimit(p.limit),
		});
	},
};

export async function handleRequest(
	method: string,
	params: unknown,
	ctx: RequestContext,
): Promise<unknown> {
	const handler = handlers[method];
	if (!handler) throw new Error(`Unknown method: ${method}`);
	return handler(params, ctx);
}
