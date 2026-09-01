import type { AgentSettlement, PendingToolPreview, TranscriptMessage } from "@gooseberry/contracts";
import { assistantFailureText } from "./assistant-failure";
import type { ChatTurn, ToolResultState } from "./types";

export interface HydratedRuntime {
	turns: ChatTurn[];
	toolResults: Record<string, ToolResultState>;
	askAnswers: Record<string, never>;
	turnIdByMessageIndex: (string | null)[];
}

/** Goose session/load replays are normalized in the server adapter before UI hydration. */
export function messagesToRuntime(
	messages: TranscriptMessage[],
	lastSettlement?: AgentSettlement | null,
	pendingTools: PendingToolPreview[] = [],
): HydratedRuntime {
	const turns: ChatTurn[] = [];
	const toolResults = Object.create(null) as Record<string, ToolResultState>;
	const turnIdByMessageIndex: (string | null)[] = [];
	for (const message of messages) {
		if (message.role === "user") {
			const id = crypto.randomUUID();
			turns.push({ kind: "user", id, message });
			turnIdByMessageIndex.push(id);
		} else if (message.role === "assistant") {
			const id = crypto.randomUUID();
			turns.push({ kind: "assistant", id, message, streaming: false });
			for (const block of message.content) {
				if (block.type === "toolCall") {
					delete toolResults[block.id];
				}
			}
			turnIdByMessageIndex.push(id);
		} else {
			toolResults[message.toolCallId] = {
				status: message.isError ? "error" : "done",
				raw: message.content,
				...(message.app ? { app: message.app } : {}),
				...(message.subagentActivity ? { subagentActivity: message.subagentActivity } : {}),
			};
			turnIdByMessageIndex.push(null);
		}
	}
	for (const preview of pendingTools) {
		toolResults[preview.toolCallId] = {
			status: "running",
			raw: preview.output,
			...(preview.app ? { app: preview.app } : {}),
			...(preview.subagentActivity ? { subagentActivity: preview.subagentActivity } : {}),
		};
	}
	const failure = assistantFailureText(lastSettlement);
	if (failure) turns.push({ kind: "error", id: crypto.randomUUID(), text: failure });
	return { turns, toolResults, askAnswers: {}, turnIdByMessageIndex };
}
