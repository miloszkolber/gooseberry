import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@mewa-code/contracts";
import { type Static, Type } from "typebox";
import type {
	ChildRunSnapshot,
	RunChildSessionInput,
	SubagentToolChild,
	SubagentToolDetails,
} from "./subagentTypes";

const MAX_TASK_LENGTH = 100_000;
const PROGRESS_INTERVAL_MS = 100;

export const SubagentParameters = Type.Object(
	{
		task: Type.String({
			minLength: 1,
			maxLength: MAX_TASK_LENGTH,
			description: "The focused task for one child Pi session.",
		}),
		model: Type.Optional(
			Type.Object(
				{
					provider: Type.String({ minLength: 1 }),
					id: Type.String({ minLength: 1 }),
				},
				{ additionalProperties: false },
			),
		),
		thinkingLevel: Type.Optional(
			Type.String({
				enum: ["off", "minimal", "low", "medium", "high", "xhigh"],
			}),
		),
	},
	{ additionalProperties: false },
);

export type SubagentParameters = Static<typeof SubagentParameters> & {
	thinkingLevel?: ThinkingLevel;
};

export interface SubagentHost {
	runChildSession(
		input: RunChildSessionInput,
		signal: AbortSignal | undefined,
		onProgress?: (snapshot: ChildRunSnapshot) => void,
	): Promise<ChildRunSnapshot>;
}

function childDetails(snapshot: ChildRunSnapshot): SubagentToolChild {
	return {
		runId: snapshot.childSessionId,
		agent: "child",
		task: snapshot.task,
		status: snapshot.status,
		model: snapshot.model,
		thinkingLevel: snapshot.thinkingLevel,
		...(snapshot.currentTool ? { currentTool: snapshot.currentTool } : {}),
		...(snapshot.finalOutput !== undefined ? { finalOutput: snapshot.finalOutput } : {}),
		...(snapshot.outputState ? { outputState: snapshot.outputState } : {}),
		...(snapshot.truncated ? { truncated: true } : {}),
		...(snapshot.error ? { error: snapshot.error } : {}),
	};
}

export function subagentDetails(snapshot: ChildRunSnapshot): SubagentToolDetails {
	return {
		mode: "single",
		runId: snapshot.childSessionId,
		parentSessionId: snapshot.parentSessionId,
		childSessionId: snapshot.childSessionId,
		status: snapshot.status,
		results: [childDetails(snapshot)],
	};
}

function resultText(snapshot: ChildRunSnapshot): string {
	switch (snapshot.status) {
		case "starting":
			return `Starting child session ${snapshot.childSessionId}.`;
		case "running":
			return snapshot.currentTool
				? `Child session ${snapshot.childSessionId} is running ${snapshot.currentTool}.`
				: `Child session ${snapshot.childSessionId} is running.`;
		case "completed":
			return (
				snapshot.finalOutput ?? `Child session ${snapshot.childSessionId} completed without output.`
			);
		case "failed":
			return `Child session ${snapshot.childSessionId} failed: ${snapshot.error ?? "unknown error"}`;
		case "cancelled":
			return `Child session ${snapshot.childSessionId} was cancelled.`;
	}
}

function toolResult(snapshot: ChildRunSnapshot): AgentToolResult<SubagentToolDetails> {
	return {
		content: [{ type: "text", text: resultText(snapshot) }],
		details: subagentDetails(snapshot),
	};
}

function registerSubagentTool(pi: ExtensionAPI, host: SubagentHost): void {
	const tool: ToolDefinition<typeof SubagentParameters, SubagentToolDetails> = {
		name: "subagent",
		label: "Subagent",
		description:
			"Run one focused task in a separate in-process Pi session. The call waits for completion. The child inherits this session's model, thinking level, workspace, tools, guards, and resources unless model or thinkingLevel is explicitly overridden.",
		parameters: SubagentParameters,
		executionMode: "sequential",
		execute: async (
			toolCallId: string,
			params: Static<typeof SubagentParameters>,
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback<SubagentToolDetails> | undefined,
			ctx: ExtensionContext,
		) => {
			const input: RunChildSessionInput = {
				parentSessionId: ctx.sessionManager.getSessionId(),
				toolCallId,
				task: params.task,
				...(params.model ? { model: params.model } : {}),
				...(params.thinkingLevel ? { thinkingLevel: params.thinkingLevel as ThinkingLevel } : {}),
			};
			let lastUpdateAt = 0;
			let pending: ChildRunSnapshot | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const flush = (terminal = false): void => {
				if (!pending || !onUpdate) return;
				if (!terminal && Date.now() - lastUpdateAt < PROGRESS_INTERVAL_MS) return;
				const snapshot = pending;
				pending = undefined;
				lastUpdateAt = Date.now();
				onUpdate(toolResult(snapshot));
			};
			const schedule = (): void => {
				if (timer !== undefined) return;
				timer = setTimeout(
					() => {
						timer = undefined;
						if (Date.now() - lastUpdateAt < PROGRESS_INTERVAL_MS) schedule();
						else flush();
					},
					Math.max(1, PROGRESS_INTERVAL_MS - (Date.now() - lastUpdateAt)),
				);
			};
			const update = (snapshot: ChildRunSnapshot): void => {
				pending = snapshot;
				if (Date.now() - lastUpdateAt >= PROGRESS_INTERVAL_MS) {
					if (timer !== undefined) clearTimeout(timer);
					timer = undefined;
					flush();
					return;
				}
				schedule();
			};

			try {
				const snapshot = await host.runChildSession(input, signal, update);
				pending = snapshot;
				if (timer !== undefined) clearTimeout(timer);
				timer = undefined;
				flush(true);
				return toolResult(snapshot);
			} finally {
				if (timer !== undefined) clearTimeout(timer);
			}
		},
	};
	pi.registerTool(tool);
}

export function subagentExtension(host: SubagentHost): ExtensionFactory {
	return (pi) => registerSubagentTool(pi, host);
}
