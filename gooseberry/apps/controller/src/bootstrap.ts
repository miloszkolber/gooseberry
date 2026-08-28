import { bootHost } from "@gooseberry/server";
import { printStartupMark } from "@gooseberry/shared/startupMark";
import { version } from "./version";

async function bootstrap(): Promise<void> {
	const { port } = await bootHost({ appVersion: version });
	const url = `http://127.0.0.1:${port}`;
	printStartupMark({ status: "host ready", endpoint: url });
	console.log(`Gooseberry → ${url}`);
}

export async function launch(): Promise<void> {
	try {
		await bootstrap();
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		process.exit(1);
	}
}
