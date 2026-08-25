import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { isProtectedPath, shellMentionsProtectedPath } from "./protected-paths";

const MAX_INSPECTED_NODES = 4096;

const PATH_KEY_PATTERN =
	/(?:^|_)(?:cwd|dir|directory|path|paths|file|files|root|roots|workdir|worktree|workspace|project|source|target|destination|dest|handoff|session|output|outputs|read|reads|artifact|artifacts|manifest|chain|async|run)(?:_|$)/;
const COMMAND_KEY_PATTERN =
	/(?:^|_)(?:command|cmd|shell|shell_command|shellcommand|gate|gate_command|run_command|exec|execute)(?:_|$)/;

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
