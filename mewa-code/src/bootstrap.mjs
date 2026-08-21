import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const piDir = process.env.PI_CODING_AGENT_DIR ?? "/var/lib/mewa/pi";
const synaraHome = process.env.SYNARA_HOME ?? "/var/lib/mewa/synara";
const settingsPath = join(piDir, "settings.json");
const bundledExtensions = [
  "/opt/mewa/extensions/mewa-remote.js",
  "/opt/mewa/extensions/mewa-browser.js",
];

for (const required of [
  "SYNARA_AUTH_TOKEN",
  "MEWA_SSH_HOST",
  "MEWA_SSH_USER",
  "MEWA_SSH_PRIVATE_KEY",
  "MEWA_SSH_KNOWN_HOST",
  "MEWA_BROWSER_TOKEN",
]) {
  if (!process.env[required]) {
    throw new Error(`${required} must be configured`);
  }
}

await mkdir(piDir, { recursive: true, mode: 0o700 });
await mkdir(synaraHome, { recursive: true, mode: 0o700 });

let settings = {};
try {
  settings = JSON.parse(await readFile(settingsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  throw new Error(`${settingsPath} must contain a JSON object`);
}

const existingExtensions = Array.isArray(settings.extensions) ? settings.extensions : [];
const stringExtensions = new Set(
  existingExtensions.filter((entry) => typeof entry === "string"),
);
for (const extension of bundledExtensions) stringExtensions.add(extension);
settings.extensions = [
  ...existingExtensions.filter((entry) => typeof entry !== "string"),
  ...stringExtensions,
];

const temporary = join(dirname(settingsPath), `.settings.${process.pid}.tmp`);
await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await rename(temporary, settingsPath);

const synara = "/app/node_modules/.bin/synara";
const args = [
  "--host",
  process.env.SYNARA_HOST ?? "0.0.0.0",
  "--port",
  process.env.SYNARA_PORT ?? "3773",
  "--no-browser",
];
const child = spawn(synara, args, {
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error("[mewa-code] failed to start Synara", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
