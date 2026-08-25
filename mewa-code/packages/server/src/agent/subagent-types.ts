import type { SessionStats, ThinkingLevel, WireModel } from "@mewa-code/contracts";
import type { ModelGroup, SubagentRole } from "./subagent-roles";

export type ChildRunStatus = "starting" | "running" | "completed" | "failed" | "cancelled";

export interface RunChildSessionInput {
	parentSessionId: string;
	toolCallId: string;
	task: string;
	role: SubagentRole;
	modelGroup?: ModelGroup;
	thinkingLevel?: ThinkingLevel;
}

export interface ChildRunSnapshot {
	parentSessionId: string;
	childSessionId: string;
	role: SubagentRole;
	task: string;
	status: ChildRunStatus;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	modelGroup: ModelGroup;
	durationMs: number;
	usage?: SessionStats;
	currentTool?: string;
	finalOutput?: string;
	outputState?: "present" | "absent";
	truncated?: boolean;
	error?: string;
}

export interface SubagentToolChild {
	runId: string;
	agent: SubagentRole;
	task: string;
	status: ChildRunStatus;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	modelGroup: ModelGroup;
	durationMs: number;
	usage?: SessionStats;
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
