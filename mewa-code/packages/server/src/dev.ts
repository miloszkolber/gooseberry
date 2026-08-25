import { resolveShellEnv } from "@mewa-code/shared/shellEnv";
import { bootHost } from "./host";

resolveShellEnv();

const host = process.env.MEWA_CODE_HOST ?? "localhost";
const staticDir = process.env.MEWA_CODE_STATIC_DIR;
const envPort = process.env.MEWA_CODE_PORT;

const { port } = await bootHost({
	port: envPort ? Number(envPort) : 24242,
	host,
	portMode: envPort ? "exact" : "free",
	...(staticDir ? { staticDir } : {}),
});
console.log(`mewa-code host: http://${host}:${port}`);
