#!/usr/bin/env bun

import { join } from "node:path";
import { findFreePort } from "@mewa-code/shared/freePort";
import { printStartupMark } from "@mewa-code/shared/startupMark";

const host = process.env.MEWA_CODE_HOST ?? "localhost";
const preferred = Number(process.env.MEWA_CODE_PORT ?? 24242);
const port = await findFreePort(preferred, host);
if (port !== preferred) {
	console.log(`mewa-code dev: host port ${preferred} is in use → using ${port}`);
}
const webPort = await findFreePort(24269, host);

const openHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
const webUrl = `http://${openHost}:${webPort}/`;
printStartupMark({ status: "starting", endpoint: webUrl });

const childOptions = {
	cwd: join(import.meta.dir, ".."),
	env: {
		...process.env,
		MEWA_CODE_PORT: String(port),
		MEWA_CODE_WEB_PORT: String(webPort),
	},
	stdin: "inherit" as const,
	stdout: "inherit" as const,
	stderr: "inherit" as const,
};
const children = [
	Bun.spawn(["bun", "--filter", "@mewa-code/web", "dev"], childOptions),
	Bun.spawn(["bun", "--filter", "@mewa-code/server", "dev"], childOptions),
];

const stop = (): void => {
	for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

void openWhenReady(webUrl);

const exitCode = await Promise.race(children.map((child) => child.exited));
stop();
process.exit(exitCode);

async function openWhenReady(url: string): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			await fetch(url);
			openBrowser(url);
			return;
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
	}
}

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
