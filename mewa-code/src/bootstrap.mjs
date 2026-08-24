import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  realpath,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const stateRoot = resolve(process.env.MEWA_STATE_DIR ?? "/home/data");
const piDir = resolve(process.env.PI_CODING_AGENT_DIR ?? join(stateRoot, "pi"));
const piSessionDir = resolve(
  process.env.PI_CODING_AGENT_SESSION_DIR ?? join(piDir, "sessions"),
);
const synaraHome = resolve(process.env.SYNARA_HOME ?? join(stateRoot, "synara"));
const settingsPath = join(piDir, "settings.json");
const extensionRoot =
  process.env.MEWA_EXTENSION_ROOT ?? "/opt/synara/mewa/dist/pi/extensions";
const browserExtension = join(extensionRoot, "mewa-browser.js");
const retiredExtensions = new Set([
  join(extensionRoot, "mewa-remote.js"),
  join(extensionRoot, "mewa-question.js"),
  join(extensionRoot, "mewa-plan.js"),
]);

for (const required of ["SYNARA_AUTH_TOKEN", "MEWA_BROWSER_TOKEN"]) {
  if (!process.env[required]) throw new Error(`${required} must be configured`);
}

const persistentDirectories = [
  stateRoot,
  piDir,
  piSessionDir,
  synaraHome,
  process.env.XDG_CONFIG_HOME,
  process.env.XDG_DATA_HOME,
  process.env.XDG_STATE_HOME,
  process.env.XDG_CACHE_HOME,
  process.env.NPM_CONFIG_CACHE,
  process.env.COREPACK_HOME,
  process.env.NODE_COMPILE_CACHE,
]
  .filter((value) => typeof value === "string" && value.length > 0)
  .map((value) => resolve(value));

await ensureStateDirectories(persistentDirectories);

if (!(await exists(browserExtension))) {
  throw new Error(`Bundled Pi extension is missing: ${browserExtension}`);
}

let settings = {};
let currentSettingsText;
try {
  currentSettingsText = await readFile(settingsPath, "utf8");
  settings = JSON.parse(currentSettingsText);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  throw new Error(`${settingsPath} must contain a JSON object`);
}

settings.extensions = mergeStringEntries(settings.extensions, [browserExtension], retiredExtensions);

const nextSettingsText = `${JSON.stringify(settings, null, 2)}\n`;
if (currentSettingsText !== nextSettingsText) {
  const temporary = join(dirname(settingsPath), `.settings.${process.pid}.tmp`);
  await writeFile(temporary, nextSettingsText, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, settingsPath);
}

const synaraEntry = process.env.SYNARA_ENTRY ?? "/opt/synara/dist/index.mjs";
if (!(await exists(synaraEntry))) {
  throw new Error(`Synara entry is missing: ${synaraEntry}`);
}

const child = spawn(
  process.execPath,
  [
    synaraEntry,
    "--host",
    process.env.SYNARA_HOST ?? "0.0.0.0",
    "--port",
    process.env.SYNARA_PORT ?? "3773",
    "--no-browser",
  ],
  { stdio: "inherit", env: process.env },
);

let forwardedSignal;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    forwardedSignal ??= signal;
    child.kill(signal);
  });
}

child.once("error", (error) => {
  console.error("[mewa-code] failed to start Synara", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  const terminationSignal = forwardedSignal ?? signal;
  if (terminationSignal) {
    process.removeAllListeners(terminationSignal);
    process.kill(process.pid, terminationSignal);
    return;
  }
  process.exitCode = code ?? 1;
});

function assertWithin(root, path) {
  const rel = relative(root, path);
  if (rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"))) {
    return;
  }
  throw new Error(`Persistent path must stay inside ${root}: ${path}`);
}

function mergeStringEntries(current, required, retired = new Set()) {
  const entries = Array.isArray(current) ? current : [];
  const strings = new Set(
    entries.filter((entry) => typeof entry === "string" && !retired.has(entry)),
  );
  for (const entry of required) strings.add(entry);
  return [...entries.filter((entry) => typeof entry !== "string"), ...strings];
}

async function ensureStateDirectories(paths) {
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  const stateInfo = await lstat(stateRoot);
  if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink()) {
    throw new Error(`State root must be a real directory: ${stateRoot}`);
  }
  const canonicalRoot = await realpath(stateRoot);
  for (const path of paths) {
    assertWithin(stateRoot, path);
    await mkdir(path, { recursive: true, mode: 0o700 });
    const canonicalPath = await realpath(path);
    assertWithin(canonicalRoot, canonicalPath);
  }
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
