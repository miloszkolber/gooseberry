import { isAbsolute, relative } from "node:path";
import type {
	AppConfigPatch,
	GitDiffScope,
	ImageContent,
	ThinkingLevel,
	WireModel,
} from "@gooseberry/contracts";
import { validateRequestImages } from "@gooseberry/contracts";
import {
	abortSession,
	clampSessionThinkingLevel,
	createSession,
	deleteSession,
	ensureSessionAttached,
	getDefaultModel,
	getSessionCommands,
	getSessionCwd,
	getSessionMessages,
	getSessionProjectId,
	getSessionStats,
	gooseRecipes,
	gooseSchedules,
	listAvailableModels,
	listProviderStatus,
	listSessions,
	promptSession,
	refreshAvailableModels,
	refreshGooseStatus,
	resolvePermission,
	setAllModelVisibility,
	setModelVisibility,
	setSessionModel,
	setSessionThinkingLevel,
	steerSession,
} from "../agent";
import { listDirectories } from "../directory-browser";
import { readDir, readFile } from "../fs";
import { canonicalPath, gitDiffFile, gitStatus, listCommits, listRepositories } from "../git";
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
	listProjects,
	openProject,
	removeProjectRoot,
} from "../projects";
import { getSignetStatus, updateConfig } from "../settings";
import { ensureWatch } from "../watch";

export interface RequestContext {
	clientKey: string;
}

type Handler = (params: unknown, ctx: RequestContext) => unknown | Promise<unknown>;

function sessionPromptParams(params: unknown): {
	sessionId: string;
	text: string;
	images?: ImageContent[];
} {
	if (typeof params !== "object" || params === null || Array.isArray(params))
		throw new Error("Malformed session request");
	const sessionId = Reflect.get(params, "sessionId");
	const text = Reflect.get(params, "text");
	const images = Reflect.get(params, "images");
	if (typeof sessionId !== "string" || typeof text !== "string")
		throw new Error("Malformed session request");
	if (images !== undefined) validateRequestImages(images);
	return images === undefined
		? { sessionId, text }
		: { sessionId, text, images: images as ImageContent[] };
}

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
	"directory.list": (params) => listDirectories(params as Record<string, unknown>),
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
	"skill.list": () => [],
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
		const value = sessionPromptParams(params);
		await promptSession(value.sessionId, value.text, value.images);
		return { ok: true } as const;
	},
	"session.steer": async (params) => {
		const value = sessionPromptParams(params);
		await steerSession(value.sessionId, value.text, value.images);
		return { ok: true } as const;
	},
	"session.abort": async (params) => {
		await abortSession((params as { sessionId: string }).sessionId);
		return { ok: true } as const;
	},
	"session.permissionReply": (params) => {
		const value = params as { sessionId: string; permissionId: string; optionId?: string };
		resolvePermission(value.sessionId, value.permissionId, value.optionId);
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
	"session.setThinkingLevel": async (params) => {
		const value = params as { sessionId: string; level: ThinkingLevel };
		await setSessionThinkingLevel(value.sessionId, value.level);
		return { ok: true } as const;
	},
	"session.getStats": (params) => getSessionStats((params as { sessionId: string }).sessionId),
	"session.getCommands": () => getSessionCommands(),
	"session.list": (params) => listSessions((params as { projectId: string }).projectId),
	"session.getMessages": async (params) => {
		const value = params as { sessionId: string; projectId: string };
		const cwd = await authorizeSession(value.projectId, value.sessionId);
		return getSessionMessages(value.sessionId, value.projectId, cwd);
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
		const value = params as { sessionId: string; level: ThinkingLevel };
		return { level: clampSessionThinkingLevel(value.sessionId, value.level) };
	},
	"model.refresh": () => refreshAvailableModels(),
	"model.default": () => getDefaultModel(),
	"model.setVisibility": (params) => {
		const value = params as { provider: string; id: string; hidden: boolean };
		return setModelVisibility(value.provider, value.id, value.hidden === true);
	},
	"model.setAllVisibility": (params) =>
		setAllModelVisibility((params as { hidden: boolean }).hidden === true),
	"provider.status": () => listProviderStatus(),
	"provider.loginStart": () => {
		throw new Error("Goose provider authentication is configured in Goose, not Gooseberry.");
	},
	"provider.loginReply": () => {
		throw new Error("Goose provider authentication is configured in Goose, not Gooseberry.");
	},
	"provider.loginCancel": () => ({ ok: true }) as const,
	"provider.logout": () => {
		throw new Error("Goose provider credentials are managed by Goose.");
	},
	"settings.update": (params) => updateConfig((params as { config: AppConfigPatch }).config),
	"signet.status": () => getSignetStatus(),
	"history.search": () => ({
		prompts: [],
		messages: [],
		promptTotal: 0,
		messageTotal: 0,
		indexing: false,
	}),
	"goose.recipeList": () => gooseRecipes().listRecipes(),
	"goose.recipeSave": (params) => {
		const value = params as { recipe: import("@gooseberry/goose-client").GooseRecipe; id?: string };
		return gooseRecipes()
			.scanRecipe(value.recipe)
			.then((scan) => {
				if (scan.hasSecurityWarnings)
					throw new Error("Goose recipe scan found security warnings. Refusing to save it.");
				return gooseRecipes().saveRecipe(value.recipe, value.id);
			});
	},
	"goose.recipeDelete": (params) =>
		gooseRecipes()
			.deleteRecipe((params as { id: string }).id)
			.then(() => ({ ok: true })),
	"goose.recipeParse": (params) =>
		gooseRecipes().parseRecipe((params as { content: string }).content),
	"goose.scheduleList": () => gooseSchedules().listSchedules(),
	"goose.scheduleCreate": (params) => {
		const v = params as {
			id: string;
			recipe: import("@gooseberry/goose-client").GooseRecipe;
			cron: string;
		};
		return gooseSchedules().createSchedule(v.id, v.recipe, v.cron);
	},
	"goose.scheduleUpdate": (params) => {
		const v = params as { scheduleId: string; cron: string };
		return gooseSchedules().updateSchedule(v.scheduleId, v.cron);
	},
	"goose.schedulePause": (params) =>
		gooseSchedules()
			.pauseSchedule((params as { scheduleId: string }).scheduleId)
			.then(() => ({ ok: true })),
	"goose.scheduleResume": (params) =>
		gooseSchedules()
			.unpauseSchedule((params as { scheduleId: string }).scheduleId)
			.then(() => ({ ok: true })),
	"goose.scheduleDelete": (params) =>
		gooseSchedules()
			.deleteSchedule((params as { scheduleId: string }).scheduleId)
			.then(() => ({ ok: true })),
	"goose.scheduleRunNow": (params) =>
		gooseSchedules().runScheduleNow((params as { scheduleId: string }).scheduleId),
	"goose.scheduleSessions": (params) => {
		const v = params as { scheduleId: string; limit?: number };
		return gooseSchedules().listScheduleSessions(v.scheduleId, v.limit ?? 10);
	},
	"goose.status": () => refreshGooseStatus(),
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
