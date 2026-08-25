import type { UserMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { SessionGoal } from "@mewa-code/contracts";
import { type Static, Type } from "typebox";
import {
	clearStoredSessionGoal,
	sessionGoalState,
	writeStoredSessionGoal,
	writeStoredSessionTasks,
} from "../persistence";

export const SESSION_GOAL_STATUS_KEY = "mewa-session-goal";
export const SESSION_GOAL_CONTEXT_PREFIX = "<mewa-session-objective>";

const ObjectiveParameters = Type.Union([
	Type.Object({
		action: Type.Literal("set_goal"),
		goal: Type.String({ minLength: 1, maxLength: 2_000 }),
	}),
	Type.Object({ action: Type.Literal("clear_goal") }),
	Type.Object({
		action: Type.Literal("set_tasks"),
		tasks: Type.Array(
			Type.Object({
				id: Type.String({ minLength: 1, maxLength: 256 }),
				text: Type.String({ minLength: 1, maxLength: 2_000 }),
				status: Type.Union([Type.Literal("pending"), Type.Literal("active"), Type.Literal("done")]),
			}),
			{ maxItems: 200 },
		),
	}),
]);

function objective(projectId: string, ctx: ExtensionContext): SessionGoal {
	return sessionGoalState(projectId, ctx.sessionManager.getSessionId());
}

function objectiveText(value: SessionGoal): string | null {
	if (!value.goal && value.tasks.length === 0) return null;
	const lines = [
		value.goal ? `Goal: ${value.goal}` : "Goal: none",
		...value.tasks.map((task, index) => `${index + 1}. [${task.status}] ${task.text}`),
	];
	return lines.join("\n");
}

export function sessionGoalContextMessage(value: SessionGoal, timestamp = Date.now()): UserMessage {
	return {
		role: "user",
		content: `${SESSION_GOAL_CONTEXT_PREFIX}\nThis is persistent user-owned session context, not a new request. Keep work aligned with it and update tasks only when progress materially changes.\n${objectiveText(value) ?? "No active objective."}\n</mewa-session-objective>`,
		timestamp,
	};
}

function updateStatus(ctx: ExtensionContext, value: SessionGoal): void {
	const active = value.tasks.filter((task) => task.status !== "done").length;
	const text = value.tasks.length
		? `${active} task${active === 1 ? "" : "s"} remaining`
		: value.goal
			? "Goal active"
			: undefined;
	ctx.ui.setStatus(SESSION_GOAL_STATUS_KEY, text);
}

export function sessionGoalExtension(projectId: string): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		pi.registerTool({
			name: "objective_update",
			label: "Update objective",
			description: "Update the persistent session goal or ordered lightweight task list.",
			parameters: ObjectiveParameters,
			executionMode: "sequential",
			execute: async (
				_toolCallId,
				params: Static<typeof ObjectiveParameters>,
				_signal,
				_onUpdate,
				ctx,
			) => {
				const sessionId = ctx.sessionManager.getSessionId();
				if (params.action === "set_goal") writeStoredSessionGoal(projectId, sessionId, params.goal);
				else if (params.action === "clear_goal") clearStoredSessionGoal(projectId, sessionId);
				else writeStoredSessionTasks(projectId, sessionId, params.tasks);
				const value = sessionGoalState(projectId, sessionId);
				updateStatus(ctx, value);
				return {
					content: [{ type: "text", text: objectiveText(value) ?? "Objective cleared." }],
					details: value,
				};
			},
		});

		pi.on("session_start", (_event, ctx) => updateStatus(ctx, objective(projectId, ctx)));
		pi.on("context", (event, ctx) => {
			const value = objective(projectId, ctx);
			updateStatus(ctx, value);
			if (!objectiveText(value)) return;
			const last = event.messages.at(-1);
			if (
				last?.role === "user" &&
				typeof last.content === "string" &&
				last.content.startsWith(`${SESSION_GOAL_CONTEXT_PREFIX}\n`)
			)
				return;
			return { messages: [...event.messages, sessionGoalContextMessage(value)] };
		});
	};
}
