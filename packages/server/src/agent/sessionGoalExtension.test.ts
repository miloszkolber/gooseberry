import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UserMessage } from "@earendil-works/pi-ai";
import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { clearStoredSessionGoal, writeStoredSessionGoal } from "../persistence";
import {
	SESSION_GOAL_CONTEXT_PREFIX,
	SESSION_GOAL_STATUS_KEY,
	sessionGoalContextMessage,
	sessionGoalExtension,
} from "./sessionGoalExtension";

type ContextHandler = (event: ContextEvent, ctx: ExtensionContext) => unknown;
type SessionStartHandler = (event: SessionStartEvent, ctx: ExtensionContext) => unknown;

let root: string;
const previousDataDir = process.env.MEWA_CODE_DATA_DIR;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "mewa-code-goal-extension-"));
	process.env.MEWA_CODE_DATA_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
});

function setup() {
	const handlers = new Map<string, (...args: never[]) => unknown>();
	const api = {
		on(event: string, handler: (...args: never[]) => unknown) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	sessionGoalExtension("workspace-a")(api);
	const statuses: Array<{ key: string; text: string | undefined }> = [];
	const ctx = {
		sessionManager: { getSessionId: () => "session-1" },
		ui: { setStatus: (key: string, text: string | undefined) => statuses.push({ key, text }) },
	} as unknown as ExtensionContext;
	return {
		context: handlers.get("context") as ContextHandler,
		start: handlers.get("session_start") as SessionStartHandler,
		ctx,
		statuses,
	};
}

describe("session goal Pi extension", () => {
	test("stays inactive without a stored goal and does not hook the host system prompt", async () => {
		const { context, start, ctx, statuses } = setup();
		start({ type: "session_start", reason: "startup" }, ctx);
		const original: UserMessage[] = [{ role: "user", content: "hello", timestamp: 1 }];
		const result = await context({ type: "context", messages: original }, ctx);

		expect(result).toBeUndefined();
		expect(statuses.at(-1)).toEqual({ key: SESSION_GOAL_STATUS_KEY, text: undefined });
		expect(original).toHaveLength(1);
	});

	test("adds ephemeral per-provider context when active and disables it after clear", async () => {
		const { context, ctx, statuses } = setup();
		writeStoredSessionGoal("workspace-a", "session-1", "Finish the focused chat");

		const original: UserMessage[] = [{ role: "user", content: "hello", timestamp: 1 }];
		const result = (await context({ type: "context", messages: original }, ctx)) as {
			messages: Array<{ role: string; content?: string }>;
		};
		expect(result.messages).toHaveLength(2);
		expect(result.messages[1]?.content).toContain("Finish the focused chat");
		expect(result.messages[1]?.content).toContain(SESSION_GOAL_CONTEXT_PREFIX);
		expect(original).toHaveLength(1);
		expect(statuses.at(-1)).toEqual({ key: SESSION_GOAL_STATUS_KEY, text: "Goal active" });

		clearStoredSessionGoal("workspace-a", "session-1");
		expect(await context({ type: "context", messages: original }, ctx)).toBeUndefined();
		expect(statuses.at(-1)).toEqual({ key: SESSION_GOAL_STATUS_KEY, text: undefined });
	});

	test("does not duplicate a context message when Pi reuses the transformed list", async () => {
		const { context, ctx } = setup();
		writeStoredSessionGoal("workspace-a", "session-1", "Keep changes scoped");
		const first = (await context({ type: "context", messages: [] }, ctx)) as {
			messages: Array<{ role: "user"; content: string; timestamp: number }>;
		};
		const second = await context({ type: "context", messages: first.messages }, ctx);
		expect(second).toBeUndefined();
		expect(first.messages.at(-1)).toMatchObject({
			role: "user",
			content: sessionGoalContextMessage("Keep changes scoped", 1).content,
		});
	});
});
