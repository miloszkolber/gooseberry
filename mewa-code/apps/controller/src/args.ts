export const DEFAULT_PORT = 24242;
export const DEFAULT_HOST = "localhost";

export interface CliOptions {
	port: number;
	host: string;
	open: boolean;
	staticDir: string | undefined;
	projectDir: string | undefined;
	acp: boolean;
	help: boolean;
	version: boolean;
}

export type ParseEnv = Record<string, string | undefined>;

export const USAGE = `Usage: mewa-code [options] [project-dir]

Boots the Mewa Code engine host in-process and opens the browser to the app.

Options:
  --port <n>     Listen port (default ${DEFAULT_PORT}; falls back to a free port if taken).
  --host <h>     Bind host (default ${DEFAULT_HOST}).
  --acp          Run the Agent Client Protocol connector over stdin/stdout.
  --no-open      Don't open the browser (e.g. headless / remote host).
  -v, --version  Print the version and exit.
  -h, --help     Show this help.

Arguments:
  project-dir    A directory to open as a project on launch (optional).

Env:
  MEWA_CODE_PORT / MEWA_CODE_HOST   Defaults for --port / --host.
	MEWA_CODE_STATIC_DIR                 Override the built web app served by the host.`;

function readFlagValue(arg: string, next: string | undefined): { value: string; consumed: number } {
	const eq = arg.indexOf("=");
	if (eq !== -1) return { value: arg.slice(eq + 1), consumed: 1 };
	if (next === undefined) throw new Error(`Missing value for ${arg}`);
	return { value: next, consumed: 2 };
}

export function parseArgs(argv: readonly string[], env: ParseEnv = {}): CliOptions {
	let port: number | undefined;
	let host: string | undefined;
	let open = true;
	let help = false;
	let version = false;
	let acp = false;
	let projectDir: string | undefined;

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i] as string;
		if (arg === "--acp") {
			acp = true;
		} else if (arg === "--no-open") {
			open = false;
		} else if (arg === "-h" || arg === "--help") {
			help = true;
		} else if (arg === "-v" || arg === "--version") {
			version = true;
		} else if (arg === "--port" || arg.startsWith("--port=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
				throw new Error(`Invalid --port: ${value}`);
			}
			port = parsed;
			i += consumed - 1;
		} else if (arg === "--host" || arg.startsWith("--host=")) {
			const { value, consumed } = readFlagValue(arg, argv[i + 1]);
			host = value;
			i += consumed - 1;
		} else if (arg.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		} else if (projectDir === undefined) {
			projectDir = arg;
		} else {
			throw new Error(`Unexpected argument: ${arg}`);
		}
	}

	const envPort = env.MEWA_CODE_PORT !== undefined ? Number(env.MEWA_CODE_PORT) : undefined;
	const resolvedPort =
		port ?? (envPort !== undefined && Number.isInteger(envPort) ? envPort : DEFAULT_PORT);

	return {
		port: resolvedPort,
		host: host ?? env.MEWA_CODE_HOST ?? DEFAULT_HOST,
		open,
		staticDir: env.MEWA_CODE_STATIC_DIR,
		projectDir,
		acp,
		help,
		version,
	};
}
