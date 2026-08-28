export const DEFAULT_PORT = 3141;
export const DEFAULT_HOST = "localhost";

export interface CliOptions {
	port: number;
	host: string;
	open: boolean;
	staticDir: string | undefined;
	projectDir: string | undefined;
	help: boolean;
	version: boolean;
}

export type ParseEnv = Record<string, string | undefined>;

export const USAGE = `Usage: gooseberry [options] [project-dir]

Boots the Gooseberry controller host in-process and opens the browser to the app.

Options:
  --port <n>     Listen port (default ${DEFAULT_PORT}; falls back to a free port if taken).
  --host <h>     Bind host (default ${DEFAULT_HOST}).
	--no-open      Don't open the browser (e.g. headless / remote host).
  -v, --version  Print the version and exit.
  -h, --help     Show this help.

Arguments:
  project-dir    A directory to open as a project on launch (optional).

Env:
  GOOSEBERRY_PORT / GOOSEBERRY_HOST   Defaults for --port / --host.
	GOOSEBERRY_PROJECT_PATH              Default project directory when no argument is given.
	GOOSEBERRY_STATIC_DIR                 Override the built web app served by the host.`;

function readFlagValue(arg: string, next: string | undefined): { value: string; consumed: number } {
	const eq = arg.indexOf("=");
	if (eq !== -1) return { value: arg.slice(eq + 1), consumed: 1 };
	if (next === undefined) throw new Error(`Missing value for ${arg}`);
	return { value: next, consumed: 2 };
}

function parsePort(value: string, source: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`Invalid ${source}: ${value}`);
	}
	return parsed;
}

function parseHost(value: string, source: string): string {
	if (value.trim().length === 0) throw new Error(`Invalid ${source}: ${value}`);
	return value;
}

export function parseArgs(argv: readonly string[], env: ParseEnv = {}): CliOptions {
	let port: number | undefined;
	let host: string | undefined;
	let open = true;
	let help = false;
	let version = false;
	let projectDir: string | undefined;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] as string;
		if (arg === "--no-open") {
			open = false;
		} else if (arg === "-h" || arg === "--help") {
			help = true;
		} else if (arg === "-v" || arg === "--version") {
			version = true;
		} else if (arg === "--port" || arg.startsWith("--port=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			port = parsePort(value, "--port");
			i += consumed - 1;
		} else if (arg === "--host" || arg.startsWith("--host=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			host = parseHost(value, "--host");
			i += consumed - 1;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		} else if (projectDir === undefined) {
			projectDir = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}

	const resolvedPort =
		port ??
		(env.GOOSEBERRY_PORT === undefined
			? DEFAULT_PORT
			: parsePort(env.GOOSEBERRY_PORT, "GOOSEBERRY_PORT"));
	const resolvedHost =
		host ??
		(env.GOOSEBERRY_HOST === undefined
			? DEFAULT_HOST
			: parseHost(env.GOOSEBERRY_HOST, "GOOSEBERRY_HOST"));

	return {
		port: resolvedPort,
		host: resolvedHost,
		open,
		staticDir: env.GOOSEBERRY_STATIC_DIR,
		projectDir: projectDir ?? env.GOOSEBERRY_PROJECT_PATH,
		help,
		version,
	};
}
