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
import { basename, join } from "node:path";
import {
	type AppConfig,
	DEFAULT_CONFIG,
	DEFAULT_SIGNET_SETTINGS,
	normalizeModelReferences,
	PROJECT_ICONS,
	type Project,
} from "@gooseberry/contracts";

const MAX_PERSISTED_JSON_BYTES = 16 * 1024 * 1024;
export const DATA_DIR = "/var/lib/gooseberry";
let dataDirOverride: string | undefined;

interface ReadJsonResult<T> {
	value: T;
	raw: string;
	mode: number | undefined;
}

type JsonValidator<T> = (value: unknown) => value is T;

export function dataDir(): string {
	return dataDirOverride ?? DATA_DIR;
}

/** Explicit test seam. The Docker runtime always persists under DATA_DIR. */
export function setDataDirForTests(path: string | undefined): void {
	dataDirOverride = path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

interface PersistedProject extends Omit<Project, "roots"> {
	roots?: string[];
	path?: string;
}

function isProjectList(value: unknown): value is PersistedProject[] {
	return (
		Array.isArray(value) &&
		value.every(
			(project) =>
				isRecord(project) &&
				typeof project.id === "string" &&
				(isStringArray(project.roots) || typeof project.path === "string") &&
				(project.name === undefined || typeof project.name === "string") &&
				(project.icon === undefined ||
					(typeof project.icon === "string" &&
						(PROJECT_ICONS as readonly string[]).includes(project.icon))) &&
				(project.slug === undefined || typeof project.slug === "string") &&
				(project.lastOpened === undefined ||
					(typeof project.lastOpened === "number" && Number.isFinite(project.lastOpened))) &&
				(project.closed === undefined || project.closed === true),
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
	const persisted = readJson<PersistedProject[]>("projects.json", [], isProjectList);
	const projects = persisted.flatMap((project): Project[] => {
		const roots = project.roots?.length ? project.roots : project.path ? [project.path] : [];
		if (roots.length === 0) return [];
		const { path: _path, roots: _roots, ...rest } = project;
		return [{ ...rest, roots }];
	});
	if (persisted.some((project) => !project.roots?.length || "path" in project))
		saveProjects(projects);
	return projects;
}

export function saveProjects(projects: Project[]): void {
	writeJson("projects.json", projects, isProjectList);
}

export function loadConfig(): AppConfig {
	const raw = readJson<Record<string, unknown>>("config.json", {}, isRecord);
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return structuredClone(DEFAULT_CONFIG);
	const value = raw as Record<string, unknown>;
	const rawSignet = isRecord(value.signet) ? value.signet : {};
	const rawPort = rawSignet.port;
	const signet = {
		enabled: typeof rawSignet.enabled === "boolean" ? rawSignet.enabled : false,
		address:
			typeof rawSignet.address === "string" && rawSignet.address.trim()
				? rawSignet.address.trim()
				: DEFAULT_SIGNET_SETTINGS.address,
		port:
			typeof rawPort === "number" && Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65_535
				? rawPort
				: DEFAULT_SIGNET_SETTINGS.port,
	};
	return {
		signet,
		hiddenModels: normalizeModelReferences(value.hiddenModels),
	};
}

export function saveConfig(config: AppConfig): void {
	writeJson("config.json", config, isRecord);
}
