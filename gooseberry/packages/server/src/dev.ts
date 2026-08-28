import { resolveShellEnv } from "@gooseberry/shared/shellEnv";
import { bootHost } from "./host";

resolveShellEnv();

const host = process.env.GOOSEBERRY_HOST ?? "localhost";
const staticDir = process.env.GOOSEBERRY_STATIC_DIR;
const envPort = process.env.GOOSEBERRY_PORT;

const { port } = await bootHost({
	port: envPort ? Number(envPort) : 3141,
	host,
	portMode: envPort ? "exact" : "free",
	...(staticDir ? { staticDir } : {}),
});
console.log(`gooseberry host: http://${host}:${port}`);
