import type { UserMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { readStoredSessionGoal } from "../persistence";

export const SESSION_GOAL_STATUS_KEY = "mewa-session-goal";
export const SESSION_GOAL_CONTEXT_PREFIX = "<mewa-session-goal>";

function sessionGoalForContext(workspaceId: string, ctx: ExtensionContext): string | null {
	try {
		return readStoredSessionGoal(workspaceId, ctx.sessionManager.getSessionId())?.goal ?? null;
	} catch {
		return null;
	}
}

export function sessionGoalContextMessage(goal: string, timestamp = Date.now()): UserMessage {
	return {
		role: "user",
		content: `${SESSION_GOAL_CONTEXT_PREFIX}\nKeep this session focused on the following user goal. Treat it as ongoing context, not a new request:\n${goal}\n</mewa-session-goal>`,
		timestamp,
	};
}

function updateGoalStatus(ctx: ExtensionContext, goal: string | null): void {
	ctx.ui.setStatus(SESSION_GOAL_STATUS_KEY, goal ? "Goal active" : undefined);
}

/**
 * Supplies the current session goal as ephemeral context for future provider calls.
 * The context hook does not append to Pi's transcript or alter its system prompt.
 */
export function sessionGoalExtension(workspaceId: string): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		pi.on("session_start", (_event, ctx) => {
			updateGoalStatus(ctx, sessionGoalForContext(workspaceId, ctx));
		});

		pi.on("context", (event, ctx) => {
			const goal = sessionGoalForContext(workspaceId, ctx);
			updateGoalStatus(ctx, goal);
			if (!goal) return;
			const contextMessage = sessionGoalContextMessage(goal);
			const last = event.messages.at(-1);
			if (
				last?.role === "user" &&
				typeof last.content === "string" &&
				last.content.startsWith(`${SESSION_GOAL_CONTEXT_PREFIX}\n`)
			) {
				return;
			}
			return { messages: [...event.messages, contextMessage] };
		});
	};
}
