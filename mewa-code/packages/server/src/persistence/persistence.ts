import { randomUUID } from "node:crypto";
import {
	chmodSync,
	closeSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	DEFAULT_PI_PROFILE_SETTINGS,
	normalizeModelReferences,
	type Project,
	type Workspace,
} from "@mewa-code/contracts";

const MAX_PERSISTED_JSON_BYTES = 16 * 1024 * 1024;

interface ReadJsonResult<T> {
	value: T;
	raw: string;
	mode: number | undefined;
}

type JsonValidator<T> = (value: unknown) => value is T;

export function dataDir(): string {
	return process.env.MEWA_CODE_DATA_DIR ?? join(homedir(), ".mewa-code");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProjectList(value: unknown): value is Project[] {
	return (
		Array.isArray(value) &&
		value.every(
			(project) =>
				isRecord(project) &&
				typeof project.id === "string" &&
				typeof project.path === "string" &&
				(project.name === undefined || typeof project.name === "string") &&
				(project.slug === undefined || typeof project.slug === "string") &&
				(project.lastOpened === undefined ||
					(typeof project.lastOpened === "number" && Number.isFinite(project.lastOpened))) &&
				(project.closed === undefined || project.closed === true) &&
				(project.trusted === undefined || typeof project.trusted === "boolean") &&
				(project.disabledSkills === undefined || isStringArray(project.disabledSkills)) &&
				(project.disabledGroups === undefined || isStringArray(project.disabledGroups)),
		)
	);
}

function isWorkspaceList(value: unknown): value is Workspace[] {
	return (
		Array.isArray(value) &&
		value.every(
			(workspace) =>
				isRecord(workspace) &&
				typeof workspace.id === "string" &&
				typeof workspace.worktreePath === "string" &&
				(workspace.projectId === undefined || typeof workspace.projectId === "string") &&
				(workspace.kind === undefined ||
					workspace.kind === "default" ||
					workspace.kind === "external") &&
				(workspace.name === undefined || typeof workspace.name === "string") &&
				(workspace.branch === undefined || typeof workspace.branch === "string") &&
				(workspace.baseBranch === undefined || typeof workspace.baseBranch === "string") &&
				(workspace.diffBase === undefined || typeof workspace.diffBase === "string") &&
				(workspace.renamed === undefined || typeof workspace.renamed === "boolean") &&
				(workspace.diffStats === undefined ||
					(isRecord(workspace.diffStats) &&
						typeof workspace.diffStats.added === "number" &&
						Number.isFinite(workspace.diffStats.added) &&
						typeof workspace.diffStats.removed === "number" &&
						Number.isFinite(workspace.diffStats.removed))) &&
				(workspace.skillOverrides === undefined ||
					(isRecord(workspace.skillOverrides) &&
						Object.values(workspace.skillOverrides).every(
							(value) => value === "on" || value === "off",
						))),
		)
	);
}

function readJsonFile<T>(file: string, validate: JsonValidator<T>): ReadJsonResult<T> | null {
	try {
		const stats = statSync(file);
		if (!stats.isFile() || stats.size > MAX_PERSISTED_JSON_BYTES) return null;
		const raw = readFileSync(file, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!validate(parsed)) return null;
		return { value: parsed, raw, mode: stats.mode & 0o7777 };
	} catch {
		return null;
	}
}

function readJson<T>(file: string, fallback: T, validate: JsonValidator<T>): T {
	const primary = join(dataDir(), file);
	const recovered = `${primary}.bak`;
	return (
		readJsonFile(primary, validate)?.value ?? readJsonFile(recovered, validate)?.value ?? fallback
	);
}

function syncFile(file: string): void {
	const fd = openSync(file, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function syncDirectory(directory: string): void {
	const fd = openSync(directory, "r");
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function writeJson(file: string, value: unknown, validate: JsonValidator<unknown>): void {
	const directory = dataDir();
	const target = join(directory, file);
	const backup = `${target}.bak`;
	const existing = readJsonFile(target, validate);
	const serialized = `${JSON.stringify(value, null, "\t")}\n`;
	if (Buffer.byteLength(serialized, "utf8") > MAX_PERSISTED_JSON_BYTES) {
		throw new Error(`Persisted JSON exceeds the ${MAX_PERSISTED_JSON_BYTES}-byte limit`);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(serialized);
	} catch (error) {
		throw new Error(`Persisted JSON is not valid: ${file}`, { cause: error });
	}
	if (!validate(parsed)) throw new Error(`Persisted JSON has an invalid shape: ${file}`);

	mkdirSync(directory, { recursive: true });
	const temporary = join(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
	const backupTemporary = join(
		directory,
		`.${basename(backup)}.${process.pid}.${randomUUID()}.tmp`,
	);
	const mode = existing?.mode;
	try {
		writeFileSync(temporary, serialized, { encoding: "utf8", mode: mode ?? 0o600 });
		if (mode !== undefined) chmodSync(temporary, mode);
		syncFile(temporary);

		if (existing) {
			writeFileSync(backupTemporary, existing.raw, { encoding: "utf8", mode: mode ?? 0o600 });
			if (mode !== undefined) chmodSync(backupTemporary, mode);
			syncFile(backupTemporary);
			renameSync(backupTemporary, backup);
		}

		renameSync(temporary, target);
		syncDirectory(directory);
	} finally {
		rmSync(temporary, { force: true });
		rmSync(backupTemporary, { force: true });
	}
}

export function loadProjects(): Project[] {
	return readJson<Project[]>("projects.json", [], isProjectList);
}

export function saveProjects(projects: Project[]): void {
	writeJson("projects.json", projects, isProjectList);
}

export function loadWorkspaces(): Workspace[] {
	return readJson<Workspace[]>("workspaces.json", [], isWorkspaceList);
}

export function saveWorkspaces(workspaces: Workspace[]): void {
	writeJson("workspaces.json", workspaces, isWorkspaceList);
}

export function loadConfig(): AppConfig {
	const raw = readJson<Record<string, unknown>>("config.json", {}, isRecord);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredClone(DEFAULT_CONFIG);
	const value = raw as Record<string, unknown>;
	const { layout: _legacyLayout, piProfile: _rawProfile, ...extensions } = value;
	const profile = isRecord(value.piProfile) ? value.piProfile : {};
	const piProfile = {
		browser:
			typeof profile.browser === "boolean" ? profile.browser : DEFAULT_PI_PROFILE_SETTINGS.browser,
		webAccess:
			typeof profile.webAccess === "boolean"
				? profile.webAccess
				: DEFAULT_PI_PROFILE_SETTINGS.webAccess,
		signetMemory:
			typeof profile.signetMemory === "boolean"
				? profile.signetMemory
				: DEFAULT_PI_PROFILE_SETTINGS.signetMemory,
		goals: typeof profile.goals === "boolean" ? profile.goals : DEFAULT_PI_PROFILE_SETTINGS.goals,
		subagents:
			typeof profile.subagents === "boolean"
				? profile.subagents
				: DEFAULT_PI_PROFILE_SETTINGS.subagents,
	};
	return {
		...extensions,
		theme: typeof value.theme === "string" ? value.theme : DEFAULT_CONFIG.theme,
		piProfile,
		hiddenModels: normalizeModelReferences(value.hiddenModels),
	};
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config, isRecord);
}
