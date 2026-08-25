import {
	type BashOperations,
	createBashToolDefinition,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	executeSshCommand,
	loadSshConfig,
	type RemoteCommandResult,
	type SshConfig,
	type SshRunner,
} from "../ssh";

export interface SshBashExtensionOptions {
	loadConfig?: () => SshConfig;
	runner?: SshRunner;
}

function remoteBashOperations(options: SshBashExtensionOptions = {}): BashOperations {
	const loadConfig = options.loadConfig ?? (() => loadSshConfig());
	return {
		exec: async (command, cwd, execution) => {
			const remoteOptions = {
				...(execution.signal ? { signal: execution.signal } : {}),
				...(execution.timeout !== undefined ? { timeoutSeconds: execution.timeout } : {}),
				onData: execution.onData,
			};
			const result: RemoteCommandResult = await executeSshCommand(
				loadConfig(),
				command,
				cwd,
				remoteOptions,
				options.runner,
			);
			return { exitCode: result.exitCode };
		},
	};
}

function registerRemoteBash(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	options: SshBashExtensionOptions,
): void {
	const operations = remoteBashOperations(options);
	pi.registerTool(
		createBashToolDefinition(ctx.cwd, {
			operations,
			// Controller/provider/browser environment values must never be sent to the host.
			exposeSessionEnvironment: false,
		}),
	);
	// Built-in bash has already been registered by this point. Re-selecting the
	// current set makes Pi use the replacement definition without adding a tool.
	pi.setActiveTools(pi.getActiveTools());
	// The controller's web UI context intentionally has no TUI theme object.
	ctx.ui.setStatus("mewa-ssh", "bash · SSH host");
}

/** Replace Pi's model-facing bash and `!` command backend without exposing SSH as a tool. */
export function sshBashExtension(pi: ExtensionAPI, options: SshBashExtensionOptions = {}): void {
	pi.on("session_start", (_event, ctx) => registerRemoteBash(pi, ctx, options));
	pi.on("user_bash", () => ({ operations: remoteBashOperations(options) }));
}

export default sshBashExtension;
