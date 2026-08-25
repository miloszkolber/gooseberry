import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	normalizeSessionGoal,
	type SessionGoal,
	type SessionTask,
	type SessionTaskStatus,
} from "@mewa-code/contracts";
import { dataDir } from "./persistence";

const OBJECTIVE_DIRECTORY = join("extensions", "session-objectives");
const LEGACY_GOAL_DIRECTORY = join("extensions", "session-goals");
const MAX_ID_LENGTH = 256;
const MAX_TASKS = 200;
const MAX_TASK_TEXT_LENGTH = 2_000;

interface StoredObjective {
	version: 2;
	projectId: string;
	sessionId: string;
	goal: string | null;
	tasks: SessionTask[];
	updatedAt: number;
}

function validateIdentity(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
		throw new Error(`${label} is invalid`);
	}
	if (value.includes("\0") || value.includes("/") || value.includes("\\")) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

function key(projectId: string, sessionId: string): string {
	validateIdentity(projectId, "Project id");
	validateIdentity(sessionId, "Session id");
	return createHash("sha256").update(`${projectId}\0${sessionId}`).digest("hex");
}

function objectiveDirectory(): string {
	return join(dataDir(), OBJECTIVE_DIRECTORY);
}

function objectiveFile(projectId: string, sessionId: string): string {
	return join(objectiveDirectory(), `${key(projectId, sessionId)}.json`);
}

function legacyFile(projectId: string, sessionId: string): string {
	return join(dataDir(), LEGACY_GOAL_DIRECTORY, `${key(projectId, sessionId)}.json`);
}

function normalizeTask(value: unknown): SessionTask {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Task is invalid");
	const id = Reflect.get(value, "id");
	const rawText = Reflect.get(value, "text");
	const status = Reflect.get(value, "status");
	if (typeof id !== "string" || !id || id.length > MAX_ID_LENGTH)
		throw new Error("Task id is invalid");
	if (typeof rawText !== "string") throw new Error("Task text is invalid");
	const text = rawText.trim();
	if (!text || text.length > MAX_TASK_TEXT_LENGTH || text.includes("\0")) {
		throw new Error("Task text is invalid");
	}
	if (status !== "pending" && status !== "active" && status !== "done") {
		throw new Error("Task status is invalid");
	}
	return { id, text, status: status as SessionTaskStatus };
}

function normalizeTasks(value: unknown): SessionTask[] {
	if (!Array.isArray(value) || value.length > MAX_TASKS) throw new Error("Task list is invalid");
	const tasks = value.map(normalizeTask);
	if (new Set(tasks.map((task) => task.id)).size !== tasks.length)
		throw new Error("Task ids must be unique");
	return tasks;
}

function parseObjective(
	value: unknown,
	projectId: string,
	sessionId: string,
): StoredObjective | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	if (Reflect.get(value, "version") !== 2) return null;
	if (
		Reflect.get(value, "projectId") !== projectId ||
		Reflect.get(value, "sessionId") !== sessionId
	)
		return null;
	const rawGoal = Reflect.get(value, "goal");
	const rawUpdatedAt = Reflect.get(value, "updatedAt");
	if (rawGoal !== null && typeof rawGoal !== "string") return null;
	if (typeof rawUpdatedAt !== "number" || !Number.isFinite(rawUpdatedAt)) return null;
	try {
		const goal = rawGoal === null ? null : normalizeSessionGoal(rawGoal);
		const tasks = normalizeTasks(Reflect.get(value, "tasks"));
		return { version: 2, projectId, sessionId, goal, tasks, updatedAt: rawUpdatedAt };
	} catch {
		return null;
	}
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as unknown;
	} catch {
		return null;
	}
}

function readLegacy(projectId: string, sessionId: string): StoredObjective | null {
	const value = readJson(legacyFile(projectId, sessionId));
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	if (Reflect.get(value, "version") !== 1 || Reflect.get(value, "sessionId") !== sessionId)
		return null;
	const owner = Reflect.get(value, "workspaceId");
	const rawGoal = Reflect.get(value, "goal");
	if (owner !== projectId || typeof rawGoal !== "string") return null;
	try {
		return {
			version: 2,
			projectId,
			sessionId,
			goal: normalizeSessionGoal(rawGoal),
			tasks: [],
			updatedAt: Number(Reflect.get(value, "updatedAt")) || Date.now(),
		};
	} catch {
		return null;
	}
}

function atomicReplace(file: string, value: StoredObjective): void {
	mkdirSync(objectiveDirectory(), { recursive: true, mode: 0o700 });
	const temporary = join(objectiveDirectory(), `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, file);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function readStoredObjective(projectId: string, sessionId: string): StoredObjective | null {
	const file = objectiveFile(projectId, sessionId);
	const stored = existsSync(file) ? parseObjective(readJson(file), projectId, sessionId) : null;
	if (stored) return stored;
	const legacy = readLegacy(projectId, sessionId);
	if (!legacy) return null;
	atomicReplace(file, legacy);
	return legacy;
}

function writeObjective(
	projectId: string,
	sessionId: string,
	goal: string | null,
	tasks: SessionTask[],
): StoredObjective {
	const stored: StoredObjective = {
		version: 2,
		projectId: validateIdentity(projectId, "Project id"),
		sessionId: validateIdentity(sessionId, "Session id"),
		goal,
		tasks: normalizeTasks(tasks),
		updatedAt: Date.now(),
	};
	atomicReplace(objectiveFile(projectId, sessionId), stored);
	return stored;
}

export function writeStoredSessionGoal(
	projectId: string,
	sessionId: string,
	value: unknown,
): StoredObjective {
	const current = readStoredObjective(projectId, sessionId);
	return writeObjective(projectId, sessionId, normalizeSessionGoal(value), current?.tasks ?? []);
}

export function writeStoredSessionTasks(
	projectId: string,
	sessionId: string,
	tasks: unknown,
): StoredObjective {
	const current = readStoredObjective(projectId, sessionId);
	return writeObjective(projectId, sessionId, current?.goal ?? null, normalizeTasks(tasks));
}

export function clearStoredSessionGoal(projectId: string, sessionId: string): void {
	const current = readStoredObjective(projectId, sessionId);
	if (!current) return;
	if (current.tasks.length > 0) writeObjective(projectId, sessionId, null, current.tasks);
	else {
		try {
			unlinkSync(objectiveFile(projectId, sessionId));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

export function clearStoredSessionGoalsForProject(projectId: string): void {
	validateIdentity(projectId, "Project id");
	let names: string[];
	try {
		names = readdirSync(objectiveDirectory());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	for (const name of names) {
		if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
		const file = join(objectiveDirectory(), name);
		try {
			if (!lstatSync(file).isFile()) continue;
			const value = readJson(file);
			if (value && typeof value === "object" && Reflect.get(value, "projectId") === projectId)
				unlinkSync(file);
		} catch {}
	}
}

export function sessionGoalState(projectId: string, sessionId: string): SessionGoal {
	const stored = readStoredObjective(projectId, sessionId);
	return {
		projectId,
		sessionId,
		goal: stored?.goal ?? null,
		tasks: stored?.tasks ?? [],
		updatedAt: stored?.updatedAt ?? null,
	};
}
