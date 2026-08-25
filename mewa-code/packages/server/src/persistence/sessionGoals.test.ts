import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SESSION_GOAL_MAX_LENGTH } from "@mewa-code/contracts";
import {
	clearStoredSessionGoal,
	readStoredSessionGoal,
	sessionGoalState,
	writeStoredSessionGoal,
} from "./sessionGoals";

let root: string;
const previousDataDir = process.env.MEWA_CODE_DATA_DIR;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "mewa-code-session-goals-"));
	process.env.MEWA_CODE_DATA_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
});

describe("session goal persistence", () => {
	test("stores one goal per workspace/session key and keeps identities isolated", () => {
		writeStoredSessionGoal("workspace-a", "session-1", "first goal");
		writeStoredSessionGoal("workspace-a", "session-2", "second session");
		writeStoredSessionGoal("workspace-b", "session-1", "other workspace");

		expect(readStoredSessionGoal("workspace-a", "session-1")?.goal).toBe("first goal");
		expect(readStoredSessionGoal("workspace-a", "session-2")?.goal).toBe("second session");
		expect(readStoredSessionGoal("workspace-b", "session-1")?.goal).toBe("other workspace");
		expect(sessionGoalState("workspace-a", "session-1")).toMatchObject({
			workspaceId: "workspace-a",
			sessionId: "session-1",
			goal: "first goal",
			active: true,
		});
		expect(readdirSync(join(root, "extensions", "session-goals"))).toHaveLength(3);
		expect(existsSync(join(root, "goals.json"))).toBe(false);
	});

	test("invalid and oversized updates preserve the last valid goal", () => {
		writeStoredSessionGoal("workspace-a", "session-1", "keep this");
		expect(() => writeStoredSessionGoal("workspace-a", "session-1", " \n ")).toThrow(
			"cannot be empty",
		);
		expect(() =>
			writeStoredSessionGoal("workspace-a", "session-1", "x".repeat(SESSION_GOAL_MAX_LENGTH + 1)),
		).toThrow("characters or fewer");
		expect(readStoredSessionGoal("workspace-a", "session-1")?.goal).toBe("keep this");
		expect(() => writeStoredSessionGoal("../outside", "session-1", "blocked")).toThrow(
			"Workspace id is invalid",
		);
	});

	test("clear removes only the active goal and is idempotent", () => {
		writeStoredSessionGoal("workspace-a", "session-1", "remove me");
		writeStoredSessionGoal("workspace-a", "session-2", "keep me");

		clearStoredSessionGoal("workspace-a", "session-1");
		clearStoredSessionGoal("workspace-a", "session-1");

		expect(sessionGoalState("workspace-a", "session-1")).toMatchObject({
			goal: null,
			active: false,
			updatedAt: null,
		});
		expect(readStoredSessionGoal("workspace-a", "session-2")?.goal).toBe("keep me");
		expect(readdirSync(join(root, "extensions", "session-goals"))).toHaveLength(1);
	});
});
