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
import { normalizeSessionGoal, type SessionGoal } from "@mewa-code/contracts";
import { dataDir } from "./persistence";

const SESSION_GOAL_DIRECTORY = join("extensions", "session-goals");
const MAX_SESSION_ID_LENGTH = 256;
const MAX_WORKSPACE_ID_LENGTH = 256;

interface StoredSessionGoal {
	version: 1;
	workspaceId: string;
	sessionId: string;
	goal: string;
	updatedAt: number;
}

function validateIdentity(value: unknown, label: string, maxLength: number): string {
	if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
		throw new Error(`${label} is invalid`);
	}
	if (value.includes("\0") || value.includes("/") || value.includes("\\")) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

function validateSessionIdentity(workspaceId: string, sessionId: string): void {
	validateIdentity(workspaceId, "Workspace id", MAX_WORKSPACE_ID_LENGTH);
	validateIdentity(sessionId, "Session id", MAX_SESSION_ID_LENGTH);
}

function sessionGoalDirectory(): string {
	return join(dataDir(), SESSION_GOAL_DIRECTORY);
}

function sessionGoalFile(workspaceId: string, sessionId: string): string {
	validateSessionIdentity(workspaceId, sessionId);
	const key = createHash("sha256").update(`${workspaceId}\0${sessionId}`).digest("hex");
	return join(sessionGoalDirectory(), `${key}.json`);
}

function parseStoredGoal(
	value: unknown,
	workspaceId: string,
	sessionId: string,
): StoredSessionGoal | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredSessionGoal>;
	if (
		candidate.version !== 1 ||
		candidate.workspaceId !== workspaceId ||
		candidate.sessionId !== sessionId ||
		typeof candidate.goal !== "string" ||
		typeof candidate.updatedAt !== "number" ||
		!Number.isFinite(candidate.updatedAt)
	) {
		return null;
	}
	try {
		if (normalizeSessionGoal(candidate.goal) !== candidate.goal) return null;
	} catch {
		return null;
	}
	return candidate as StoredSessionGoal;
}

export function readStoredSessionGoal(
	workspaceId: string,
	sessionId: string,
): { goal: string; updatedAt: number } | null {
	const file = sessionGoalFile(workspaceId, sessionId);
	if (!existsSync(file)) return null;
	try {
		const parsed = parseStoredGoal(
			JSON.parse(readFileSync(file, "utf8")) as unknown,
			workspaceId,
			sessionId,
		);
		return parsed ? { goal: parsed.goal, updatedAt: parsed.updatedAt } : null;
	} catch {
		return null;
	}
}

function atomicReplace(file: string, value: StoredSessionGoal): void {
	const directory = sessionGoalDirectory();
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, file);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function writeStoredSessionGoal(
	workspaceId: string,
	sessionId: string,
	value: unknown,
): StoredSessionGoal {
	validateSessionIdentity(workspaceId, sessionId);
	const goal = normalizeSessionGoal(value);
	const stored: StoredSessionGoal = {
		version: 1,
		workspaceId,
		sessionId,
		goal,
		updatedAt: Date.now(),
	};
	atomicReplace(sessionGoalFile(workspaceId, sessionId), stored);
	return stored;
}

export function clearStoredSessionGoal(workspaceId: string, sessionId: string): void {
	const file = sessionGoalFile(workspaceId, sessionId);
	try {
		unlinkSync(file);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
}

export function clearStoredSessionGoalsForWorkspace(workspaceId: string): void {
	validateIdentity(workspaceId, "Workspace id", MAX_WORKSPACE_ID_LENGTH);
	const directory = sessionGoalDirectory();
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}

	for (const name of names) {
		if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
		const file = join(directory, name);
		let parsed: unknown;
		try {
			if (!lstatSync(file).isFile()) continue;
			parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
		const sessionId = Reflect.get(parsed, "sessionId");
		if (typeof sessionId !== "string") continue;
		try {
			if (sessionGoalFile(workspaceId, sessionId) !== file) continue;
		} catch {
			continue;
		}
		if (!parseStoredGoal(parsed, workspaceId, sessionId)) continue;
		try {
			unlinkSync(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
}

export function sessionGoalState(workspaceId: string, sessionId: string): SessionGoal {
	const stored = readStoredSessionGoal(workspaceId, sessionId);
	return {
		workspaceId,
		sessionId,
		goal: stored?.goal ?? null,
		active: stored !== null,
		updatedAt: stored?.updatedAt ?? null,
	};
}
