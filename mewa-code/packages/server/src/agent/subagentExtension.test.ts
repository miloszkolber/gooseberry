import { expect, test } from "bun:test";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type SubagentParameters, subagentExtension } from "./subagentExtension";
import type { ChildRunSnapshot, RunChildSessionInput, SubagentToolDetails } from "./subagentTypes";

test("registers one blocking built-in tool with a narrow schema", async () => {
	const tools: ToolDefinition[] = [];
	const fakePi = {
		registerTool(tool: ToolDefinition) {
			tools.push(tool);
		},
	} as unknown as ExtensionAPI;
	const completed: ChildRunSnapshot = {
		parentSessionId: "parent",
		childSessionId: "child",
		task: "Inspect the patch",
		status: "completed",
		model: null,
		thinkingLevel: "medium",
		finalOutput: "done",
		outputState: "present",
	};
	const host = {
		runChildSession: async (
			_input: RunChildSessionInput,
			_signal: AbortSignal | undefined,
			onProgress?: (snapshot: ChildRunSnapshot) => void,
		) => {
			onProgress?.({ ...completed, status: "running", currentTool: "read" });
			return completed;
		},
	};
	subagentExtension(host)(fakePi);

	expect(tools).toHaveLength(1);
	const tool = tools[0] as ToolDefinition<typeof SubagentParameters, SubagentToolDetails>;
	expect(tool.name).toBe("subagent");
	expect(tool.executionMode).toBe("sequential");
	expect(Object.keys(tool.parameters.properties)).toEqual(["task", "model", "thinkingLevel"]);
	expect(
		(tool.parameters as unknown as { additionalProperties?: boolean }).additionalProperties,
	).toBe(false);

	const updates: SubagentToolDetails[] = [];
	const result = await tool.execute(
		"call-1",
		{ task: "Inspect the patch" },
		undefined,
		(partial) => updates.push(partial.details),
		{ sessionManager: { getSessionId: () => "parent" } } as never,
	);
	expect(result.details.status).toBe("completed");
	expect(result.details.results[0]?.finalOutput).toBe("done");
	expect(updates.some((update) => update.status === "running")).toBe(true);
	expect(result.content[0]).toMatchObject({ type: "text", text: "done" });
});
