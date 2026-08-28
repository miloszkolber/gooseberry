import { resolveShellEnv } from "@gooseberry/shared/shellEnv";
import { settleSessionsForShutdown } from "../agent";
import { installCrashLog } from "./crash-log";
import { createServer, type RunningServer } from "./server";
import { validateAuthTokens } from "./web-socket-auth";

export interface BootHostOptions {
	appVersion?: string;
}

export interface BootedHost {
	readonly server: RunningServer;
	readonly port: number;
}

export async function bootHost(options: BootHostOptions): Promise<BootedHost> {
	validateAuthTokens();
	installCrashLog(options.appVersion);
	resolveShellEnv();

	const server = await createServer({
		...(options.appVersion ? { appVersion: options.appVersion } : {}),
	});

	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		void (async () => {
			try {
				await settleSessionsForShutdown();
			} finally {
				server.stop();
				process.exit(0);
			}
		})();
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	return { server, port: server.port };
}
