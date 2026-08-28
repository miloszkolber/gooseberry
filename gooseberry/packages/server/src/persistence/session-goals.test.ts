import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SESSION_GOAL_MAX_LENGTH } from "@gooseberry/contracts";
import {
	clearStoredSessionGoal,
	sessionGoalState,
	writeStoredSessionGoal,
	writeStoredSessionTasks,
} from "./session-goals";

let root: string;
const previousDataDir = process.env.GOOSEBERRY_DATA_DIR;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "gooseberry-objectives-"));
	process.env.GOOSEBERRY_DATA_DIR = root;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.GOOSEBERRY_DATA_DIR;
	else process.env.GOOSEBERRY_DATA_DIR = previousDataDir;
});

describe("session objective persistence", () => {
	test("isolates goal and ordered tasks by project and session", () => {
		writeStoredSessionGoal("project-a", "session-1", "ship it");
		writeStoredSessionTasks("project-a", "session-1", [
			{ id: "one", text: "Implement", status: "active" },
			{ id: "two", text: "Verify", status: "pending" },
		]);
		expect(sessionGoalState("project-a", "session-1")).toMatchObject({
			projectId: "project-a",
			goal: "ship it",
			tasks: [
				{ id: "one", status: "active" },
				{ id: "two", status: "pending" },
			],
		});
		expect(sessionGoalState("project-b", "session-1").goal).toBeNull();
	});

	test("invalid updates preserve valid objective state", () => {
		writeStoredSessionGoal("project-a", "session-1", "keep");
		expect(() =>
			writeStoredSessionGoal("project-a", "session-1", "x".repeat(SESSION_GOAL_MAX_LENGTH + 1)),
		).toThrow();
		expect(() =>
			writeStoredSessionTasks("project-a", "session-1", [
				{ id: "one", text: "", status: "pending" },
			]),
		).toThrow();
		expect(sessionGoalState("project-a", "session-1").goal).toBe("keep");
	});

	test("clearing a goal preserves tasks", () => {
		writeStoredSessionGoal("project-a", "session-1", "remove");
		writeStoredSessionTasks("project-a", "session-1", [
			{ id: "one", text: "Keep", status: "done" },
		]);
		clearStoredSessionGoal("project-a", "session-1");
		expect(sessionGoalState("project-a", "session-1")).toMatchObject({
			goal: null,
			tasks: [{ text: "Keep" }],
		});
	});
});
