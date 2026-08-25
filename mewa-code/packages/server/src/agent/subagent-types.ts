import type { ThinkingLevel, WireModel } from "@mewa-code/contracts";

export interface ChildModelRef {
	provider: string;
	id: string;
}

export type ChildRunStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

export interface RunChildSessionInput {
	parentSessionId: string;
	toolCallId: string;
	task: string;
	model?: ChildModelRef;
	thinkingLevel?: ThinkingLevel;
}

export interface ChildRunSnapshot {
	parentSessionId: string;
	childSessionId: string;
	task: string;
	status: ChildRunStatus;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	currentTool?: string;
	finalOutput?: string;
	outputState?: "present" | "absent";
	truncated?: boolean;
	error?: string;
}

export interface SubagentToolChild {
	runId: string;
	agent: "child";
	task: string;
	status: ChildRunStatus;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	currentTool?: string;
	finalOutput?: string;
	outputState?: "present" | "absent";
	truncated?: boolean;
	error?: string;
}

export interface SubagentToolDetails {
	mode: "single";
	runId: string;
	parentSessionId: string;
	childSessionId: string;
	status: ChildRunStatus;
	results: [SubagentToolChild];
}
