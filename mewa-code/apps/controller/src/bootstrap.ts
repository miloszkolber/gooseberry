import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { bootHost } from "@mewa-code/server";
import { runAcp } from "@mewa-code/server/acp";
import { printStartupMark } from "@mewa-code/shared/startupMark";
import { type CliOptions, parseArgs, USAGE } from "./args";
import { version } from "./version";

const DEFAULT_STATIC_DIR = resolve(import.meta.dir, "../../../webui/dist");

function openBrowser(url: string): void {
	const command =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	try {
		Bun.spawn(command, { stdout: "ignore", stderr: "ignore" }).unref();
	} catch {}
}

async function bootstrap(): Promise<void> {
	const argv = Bun.argv.slice(2);

	let options: CliOptions;
	try {
		options = parseArgs(argv, process.env);
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		console.error(`\n${USAGE}`);
		process.exit(1);
	}

	if (options.help) {
		console.log(USAGE);
		return;
	}

	if (options.version) {
		console.log(version);
		return;
	}

	if (options.acp) {
		if (options.projectDir) {
			throw new Error("--acp does not accept a project-dir argument; the ACP client supplies cwd");
		}
		await runAcp({ appVersion: version });
		// Pi's in-process runtime may retain provider/resource handles after ACP
		// stdin closes. ACP is a subprocess protocol, so terminate once the
		// connector has flushed and disposed its sessions.
		process.exit(0);
		return;
	}

	const staticDir = options.staticDir ?? DEFAULT_STATIC_DIR;
	if (!existsSync(staticDir)) {
		console.warn(`Web app not found at ${staticDir} — run \`bun run build:web\` to build the UI.`);
	}

	const { port, requested } = await bootHost({
		port: options.port,
		host: options.host,
		portMode: "free",
		staticDir,
		appVersion: version,
		...(options.projectDir ? { projectPath: resolve(process.cwd(), options.projectDir) } : {}),
	});
	if (port !== requested) {
		console.warn(`Port ${requested} is in use; using free port ${port}.`);
	}

	const openHost = options.host === "0.0.0.0" || options.host === "::" ? "localhost" : options.host;
	const url = `http://${openHost}:${port}`;
	printStartupMark({ status: "host ready", endpoint: url });
	console.log(`mewa-code → ${url}`);
	if (options.open) openBrowser(url);
}

export async function launch(): Promise<void> {
	try {
		await bootstrap();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
