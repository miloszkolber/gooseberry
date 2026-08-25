import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { isProtectedPath, shellMentionsProtectedPath } from "./protectedPaths";

const MAX_INSPECTED_NODES = 4096;

/**
 * pi-subagents has a deliberately broad request shape. Keep this list based on
 * semantic names rather than one version's exact schema so nested child/task
 * records from future releases are still covered.
 */
const PATH_KEY_PATTERN =
	/(?:^|_)(?:cwd|dir|directory|path|paths|file|files|root|roots|workdir|worktree|workspace|project|source|target|destination|dest|handoff|session|output|outputs|read|reads|artifact|artifacts|manifest|chain|async|run)(?:_|$)/;
const COMMAND_KEY_PATTERN =
	/(?:^|_)(?:command|cmd|shell|shell_command|shellcommand|gate|gate_command|run_command|exec|execute)(?:_|$)/;
const WORKFLOW_SCRIPT_KEYS = new Set(["workflow_script", "workflow", "script"]);
const OPAQUE_SUBAGENT_KEYS = new Set([
	"config",
	"mission",
	"mission_update",
	"extension_bindings",
	"code",
	"expression",
]);
const SHARING_KEYS = new Set([
	"share",
	"sharing",
	"upload",
	"uploads",
	"upload_path",
	"upload_file",
	"gist",
	"gist_url",
]);

type InspectionMode = "path" | "command" | "unknown";

interface GuardInspectionOptions {
	cwd: string;
	roots: readonly string[];
	env: NodeJS.ProcessEnv;
}

interface InspectionState {
	seen: WeakSet<object>;
	count: number;
	unsafe: boolean;
	options: GuardInspectionOptions;
	toolName: string;
}

function normalizedKey(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[\s.-]+/g, "_")
		.toLowerCase();
}

function modeForKey(key: string): InspectionMode {
	const normalized = normalizedKey(key);
	if (COMMAND_KEY_PATTERN.test(normalized)) return "command";
	if (PATH_KEY_PATTERN.test(normalized)) return "path";
	return "unknown";
}

function isSubagentTool(toolName: string): boolean {
	return toolName === "subagent" || toolName.startsWith("subagent_");
}

function hasSharingValue(value: unknown): boolean {
	if (value === false || value === undefined || value === null) return false;
	// The schema currently accepts boolean false or a value that enables sharing.
	// Fail closed for any future truthy shape rather than allowing an upload path
	// to hide inside an object or array.
	return Boolean(value);
}

function inspectValue(value: unknown, mode: InspectionMode, state: InspectionState): boolean {
	if (state.unsafe) return true;
	if (typeof value === "string") {
		if (mode === "path") return isProtectedPath(value, state.options);
		if (mode === "command") return shellMentionsProtectedPath(value, state.options);
		return false;
	}
	if (value === null || typeof value !== "object") return false;
	state.count += 1;
	if (state.count > MAX_INSPECTED_NODES) {
		state.unsafe = true;
		return true;
	}
	if (state.seen.has(value)) return false;
	state.seen.add(value);

	if (Array.isArray(value)) {
		for (const item of value) {
			if (inspectValue(item, mode, state)) return true;
		}
		return false;
	}

	let entries: Array<[string, unknown]>;
	try {
		entries = Object.entries(value);
	} catch {
		state.unsafe = true;
		return true;
	}
	for (const [key, child] of entries) {
		const normalized = normalizedKey(key);
		if (isSubagentTool(state.toolName) && WORKFLOW_SCRIPT_KEYS.has(normalized)) {
			// A workflow script is executable orchestration code. Regex-scanning its
			// source is not a proof that every runtime-generated child path is safe.
			state.unsafe = true;
			return true;
		}
		if (
			isSubagentTool(state.toolName) &&
			OPAQUE_SUBAGENT_KEYS.has(normalized) &&
			child !== false &&
			child !== null &&
			child !== undefined
		) {
			// These fields are intentionally open-ended extension/configuration
			// surfaces. They may carry paths or commands that this guard cannot
			// soundly enumerate.
			state.unsafe = true;
			return true;
		}
		if (SHARING_KEYS.has(normalized) && hasSharingValue(child)) {
			state.unsafe = true;
			return true;
		}
		if (inspectValue(child, modeForKey(key), state)) return true;
	}
	return false;
}

function inputMentionsProtectedState(
	toolName: string,
	input: unknown,
	options: GuardInspectionOptions,
): boolean {
	const state: InspectionState = {
		seen: new WeakSet<object>(),
		count: 0,
		unsafe: false,
		options,
		toolName,
	};
	return inspectValue(
		input,
		toolName === "bash" || toolName === "powershell" ? "command" : "unknown",
		state,
	);
}

export function protectedStateGuard(
	cwd: string,
	roots: readonly string[],
	env: NodeJS.ProcessEnv = process.env,
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		pi.on("tool_call", (event) => {
			const blocked = inputMentionsProtectedState(event.toolName, event.input, {
				cwd,
				roots,
				env,
			});
			if (!blocked) return;
			return {
				block: true,
				reason: "Access to Pi or Mewa state is blocked from the project context.",
			};
		});
	};
}
