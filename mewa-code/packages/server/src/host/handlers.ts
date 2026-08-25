import { isAbsolute, relative } from "node:path";
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
	getSessionCommands,
	getSessionCwd,
	getSessionMessages,
	getSessionProjectId,
	getSessionStats,
	hasSession,
	listAvailableModels,
	listSessions,
	listSkillCommands,
	promptSession,
	refreshAvailableModels,
	reloadSessionResources,
	removeQueuedSession,
	resolveExtUi,
	setAllModelVisibility,
	setModelVisibility,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
} from "../agent";
import { cancelLogin, getProviderStatus, logoutProvider, resolveLogin, startLogin } from "../auth";
import { selectDirectory } from "../dialog";
import { readDir, readFile } from "../fs";
import { canonicalPath, gitDiffFile, gitStatus, listCommits, listRepositories } from "../git";
import { clampLimit, getHistoryIndex } from "../history";
import {
	clearStoredSessionGoal,
	loadProjectSessionRecords,
	sessionGoalState,
	writeStoredSessionGoal,
	writeStoredSessionTasks,
} from "../persistence";
import {
	addProjectRoot,
	assertProjectCwd,
	closeProject,
	getProject,
	listProjects,
	openProject,
	removeProjectRoot,
} from "../projects";
import { getSignetStatus, updateConfig } from "../settings";
import { ensureWatch } from "../watch";
import { ackSend } from "./ack-send";
import { buildHistoryScope } from "./history-scope";

export interface RequestContext {
	clientKey: string;
}

type Handler = (params: unknown, ctx: RequestContext) => unknown | Promise<unknown>;

function recordedCwd(projectId: string, sessionId: string): string | undefined {
	return loadProjectSessionRecords().find(
		(record) => record.projectId === projectId && record.sessionId === sessionId,
	)?.cwd;
}

async function authorizeSession(projectId: unknown, sessionId: unknown): Promise<string> {
	if (typeof projectId !== "string" || typeof sessionId !== "string") {
		throw new Error("Malformed session request");
	}
	const liveCwd = getSessionCwd(sessionId);
	if (liveCwd) {
		if (getSessionProjectId(sessionId) !== projectId)
			throw new Error(`Unknown session: ${sessionId}`);
		return assertProjectCwd(projectId, liveCwd);
	}
	const cwd = recordedCwd(projectId, sessionId);
	if (!cwd) throw new Error(`Unknown session: ${sessionId}`);
	const admitted = assertProjectCwd(projectId, cwd);
	if (!(await ensureSessionAttached(sessionId, projectId, admitted))) {
		throw new Error(`Unknown session: ${sessionId}`);
	}
	return admitted;
}

const handlers: Record<string, Handler> = {
	"project.open": (params) => openProject((params as { path: string }).path),
	"project.addRoot": (params) => {
		const value = params as { id: string; path: string };
		return addProjectRoot(value.id, value.path);
	},
	"project.removeRoot": (params) => {
		const value = params as { id: string; path: string };
		const root = canonicalPath(value.path);
		const ownsSession = loadProjectSessionRecords().some((record) => {
			if (record.projectId !== value.id) return false;
			const rel = relative(root, canonicalPath(record.cwd));
			return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
		});
		if (ownsSession) throw new Error("Move or delete sessions using this root before removing it.");
		return removeProjectRoot(value.id, value.path);
	},
	"project.list": () => listProjects(),
	"project.close": (params) => {
		closeProject((params as { id: string }).id);
		return { ok: true } as const;
	},
	"project.watchReady": (params) => {
		const value = params as { projectId: string; prewarm?: boolean };
		return ensureWatch(value.projectId, { prewarm: value.prewarm === true });
	},
	"git.listRepositories": (params) => listRepositories((params as { projectId: string }).projectId),
	"dialog.selectDirectory": () => selectDirectory(),
	"fs.readDir": (params) => {
		const value = params as { projectId: string; root: string; path: string };
		void ensureWatch(value.projectId);
		return readDir(value.projectId, value.root, value.path);
	},
	"fs.readFile": (params) => {
		const value = params as { projectId: string; root: string; path: string };
		void ensureWatch(value.projectId);
		return readFile(value.projectId, value.root, value.path);
	},
	"git.status": (params) => {
		const value = params as { projectId: string; repository: string };
		void ensureWatch(value.projectId);
		return gitStatus(value.projectId, value.repository);
	},
	"git.diffFile": (params) => {
		const value = params as {
			projectId: string;
			repository: string;
			path: string;
			scope?: GitDiffScope;
		};
		return gitDiffFile(value.projectId, value.repository, value.path, value.scope);
	},
	"git.listCommits": (params) => {
		const value = params as { projectId: string; repository: string };
		return listCommits(value.projectId, value.repository);
	},
	"skill.list": (params) => {
		const project = getProject((params as { projectId: string }).projectId);
		const cwd = project.roots[0];
		if (!cwd) return [];
		return listSkillCommands(cwd);
	},
	"session.reloadResources": async (params) => {
		await reloadSessionResources((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.create": async (params) => {
		const value = params as {
			projectId: string;
			cwd?: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		return createSession({
			projectId: value.projectId,
			cwd: assertProjectCwd(value.projectId, value.cwd),
			...(value.model ? { model: value.model } : {}),
			...(value.thinkingLevel ? { thinkingLevel: value.thinkingLevel } : {}),
		});
	},
	"session.prompt": async (params) => {
		const value = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(promptSession(value.sessionId, value.text, value.images));
		return { ok: true } as const;
	},
	"session.steer": async (params) => {
		const value = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(steerSession(value.sessionId, value.text, value.images));
		return { ok: true } as const;
	},
	"session.followUp": async (params) => {
		const value = params as { sessionId: string; text: string; images?: ImageContent[] };
		await ackSend(followUpSession(value.sessionId, value.text, value.images));
		return { ok: true } as const;
	},
	"session.clearQueue": (params) => clearQueueSession((params as { sessionId: string }).sessionId),
	"session.removeQueued": (params) => {
		const value = params as { sessionId: string; kind: QueueLane; index: number };
		return removeQueuedSession(value.sessionId, value.kind, value.index);
	},
	"session.abort": async (params) => {
		await abortSession((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.delete": async (params) => {
		const value = params as { projectId: string; sessionId: string };
		const cwd = await authorizeSession(value.projectId, value.sessionId);
		await deleteSession(value.sessionId, value.projectId, cwd);
		return { ok: true } as const;
	},
	"session.setModel": async (params) => {
		const value = params as { sessionId: string; model: WireModel };
		await setSessionModel(value.sessionId, value.model);
		return { ok: true } as const;
	},
	"session.setThinkingLevel": (params) => {
		const value = params as { sessionId: string; level: ThinkingLevel };
		setSessionThinkingLevel(value.sessionId, value.level);
		return { ok: true } as const;
	},
	"session.compact": async (params) => {
		const value = params as { sessionId: string; instructions?: string };
		await compactSession(value.sessionId, value.instructions);
		return { ok: true } as const;
	},
	"session.getStats": (params) => getSessionStats((params as { sessionId: string }).sessionId),
	"session.getCommands": (params) =>
		getSessionCommands((params as { sessionId: string }).sessionId),
	"session.list": (params) => listSessions((params as { projectId: string }).projectId),
	"session.getMessages": async (params) => {
		const value = params as { sessionId: string; projectId: string };
		const cwd = await authorizeSession(value.projectId, value.sessionId);
		return getSessionMessages(value.sessionId, value.projectId, cwd);
	},
	"session.extUiReply": (params) => {
		resolveExtUi((params as { response: ExtUiResponse }).response);
		return { ok: true } as const;
	},
	"session.answerQuestion": async (params) => {
		const value = params as {
			sessionId: string;
			toolCallId: string;
			result: AskUserQuestionResult;
		};
		if (!hasSession(value.sessionId)) throw new Error(`Unknown session: ${value.sessionId}`);
		if (
			!value.result ||
			!Array.isArray(value.result.answers) ||
			typeof value.result.cancelled !== "boolean"
		) {
			throw new Error("Malformed ask_user_question result");
		}
		await ackSend(answerQuestion(value.sessionId, value.toolCallId, value.result));
		return { ok: true } as const;
	},
	"session.goalGet": async (params) => {
		const value = params as { projectId?: unknown; sessionId?: unknown };
		await authorizeSession(value.projectId, value.sessionId);
		return sessionGoalState(value.projectId as string, value.sessionId as string);
	},
	"session.goalSet": async (params) => {
		const value = params as { projectId?: unknown; sessionId?: unknown; goal?: unknown };
		await authorizeSession(value.projectId, value.sessionId);
		writeStoredSessionGoal(value.projectId as string, value.sessionId as string, value.goal);
		return sessionGoalState(value.projectId as string, value.sessionId as string);
	},
	"session.goalClear": async (params) => {
		const value = params as { projectId?: unknown; sessionId?: unknown };
		await authorizeSession(value.projectId, value.sessionId);
		clearStoredSessionGoal(value.projectId as string, value.sessionId as string);
		return sessionGoalState(value.projectId as string, value.sessionId as string);
	},
	"session.tasksSet": async (params) => {
		const value = params as { projectId?: unknown; sessionId?: unknown; tasks?: unknown };
		await authorizeSession(value.projectId, value.sessionId);
		writeStoredSessionTasks(value.projectId as string, value.sessionId as string, value.tasks);
		return sessionGoalState(value.projectId as string, value.sessionId as string);
	},
	"model.list": () => listAvailableModels(),
	"model.clampThinking": async (params) => {
		const value = params as { provider: string; id: string; level: ThinkingLevel };
		return {
			level: await clampThinkingForModel({ provider: value.provider, id: value.id }, value.level),
		};
	},
	"model.refresh": (params) =>
		refreshAvailableModels((params as { force?: boolean }).force === true),
	"model.default": () => getDefaultModel(),
	"model.setVisibility": (params) => {
		const value = params as { provider: string; id: string; hidden: boolean };
		return setModelVisibility(value.provider, value.id, value.hidden === true);
	},
	"model.setAllVisibility": (params) =>
		setAllModelVisibility((params as { hidden: boolean }).hidden === true),
	"provider.status": () => getProviderStatus(),
	"provider.loginStart": (params) => {
		const value = params as { providerId: string; type?: "oauth" | "api_key" };
		return startLogin(value.providerId, value.type ?? "oauth");
	},
	"provider.loginReply": (params) => {
		resolveLogin(params as LoginReply);
		return { ok: true } as const;
	},
	"provider.loginCancel": (params) => {
		cancelLogin((params as { loginId: string }).loginId);
		return { ok: true } as const;
	},
	"provider.logout": async (params) => {
		await logoutProvider((params as { providerId: string }).providerId);
		return { ok: true } as const;
	},
	"settings.update": (params) => updateConfig((params as { config: AppConfigPatch }).config),
	"signet.status": () => getSignetStatus(),
	"history.search": (params) => {
		const value = params as { query: string; scope: HistoryScope; limit?: number };
		const { filter, labels } = buildHistoryScope(
			value.scope,
			listProjects(),
			loadProjectSessionRecords(),
		);
		return getHistoryIndex().search({
			query: value.query,
			filter,
			labels,
			limit: clampLimit(value.limit),
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
