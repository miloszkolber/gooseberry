import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./persistence";

export interface ProjectSessionRecord {
	projectId: string;
	sessionId: string;
	cwd: string;
}

function file(): string {
	return join(dataDir(), "project-sessions.json");
}

function valid(value: unknown): value is ProjectSessionRecord[] {
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

export function loadProjectSessionRecords(): ProjectSessionRecord[] {
	try {
		const value: unknown = JSON.parse(readFileSync(file(), "utf8"));
		return valid(value) ? value : [];
	} catch {
		return [];
	}
}

function save(records: ProjectSessionRecord[]): void {
	const directory = dataDir();
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = join(directory, `.project-sessions.${randomUUID()}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(records, null, "\t")}\n`, {
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
