import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./persistence";

export interface ProjectSessionRecord {
	projectId: string;
	sessionId: string;
	cwd: string;
}

interface VersionedProjectSessions {
	version: 2;
	engine: "goose";
	records: ProjectSessionRecord[];
}

function file(): string {
	return join(dataDir(), "project-sessions.json");
}

function validRecords(value: unknown): value is ProjectSessionRecord[] {
	return (
		Array.isArray(value) &&
		value.every(
			(record) =>
				record &&
				typeof record === "object" &&
				!Array.isArray(record) &&
				typeof Reflect.get(record, "projectId") === "string" &&
				typeof Reflect.get(record, "sessionId") === "string" &&
				typeof Reflect.get(record, "cwd") === "string",
		)
	);
}

function versioned(value: unknown): value is VersionedProjectSessions {
	return (
		typeof value === "object" &&
		value !== null &&
		Reflect.get(value, "version") === 2 &&
		Reflect.get(value, "engine") === "goose" &&
		validRecords(Reflect.get(value, "records"))
	);
}

export function loadProjectSessionRecords(): ProjectSessionRecord[] {
	try {
		const value: unknown = JSON.parse(readFileSync(file(), "utf8"));
		if (versioned(value)) return value.records;
		// A bare array is an unversioned legacy index. Its identifiers are not
		// Goose session identifiers, so never attempt to load them through ACP.
		return [];
	} catch {
		return [];
	}
}

function save(records: ProjectSessionRecord[]): void {
	const directory = dataDir();
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.project-sessions.${randomUUID()}.tmp`);
	try {
		const value: VersionedProjectSessions = { version: 2, engine: "goose", records };
		writeFileSync(temporary, `${JSON.stringify(value, null, "\t")}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporary, file());
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function recordProjectSession(record: ProjectSessionRecord): void {
	const records = loadProjectSessionRecords();
	const index = records.findIndex((candidate) => candidate.sessionId === record.sessionId);
	if (index === -1) records.push(record);
	else records[index] = record;
	save(records);
}

export function forgetProjectSession(projectId: string, sessionId: string): void {
	save(
		loadProjectSessionRecords().filter(
			(record) => record.projectId !== projectId || record.sessionId !== sessionId,
		),
	);
}

export function forgetProjectSessions(projectId: string): void {
	save(loadProjectSessionRecords().filter((record) => record.projectId !== projectId));
}
