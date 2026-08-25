import { findFreePort } from "@mewa-code/shared/freePort";
import { resolveShellEnv } from "@mewa-code/shared/shellEnv";
import { settleSessionsForShutdown } from "../agent";
import { installCrashLog } from "./crash-log";
import { createServer, type RunningServer } from "./server";
import { validateAuthTokens } from "./web-socket-auth";

export interface BootHostOptions {
	port: number;
	host: string;
	portMode: "exact" | "free";
	staticDir?: string;
	projectPath?: string;
	appVersion?: string;
}

export interface BootedHost {
	readonly server: RunningServer;
	readonly port: number;
	readonly requested: number;
}

export async function bootHost(options: BootHostOptions): Promise<BootedHost> {
	validateAuthTokens();
	installCrashLog(options.appVersion);
	resolveShellEnv();

	const requested = options.port;
	const port =
		options.portMode === "free" ? await findFreePort(requested, options.host) : requested;

	const server = await createServer({
		port,
		host: options.host,
		...(options.staticDir ? { staticDir: options.staticDir } : {}),
		...(options.projectPath ? { projectPath: options.projectPath } : {}),
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

	return { server, port: server.port, requested };
}
