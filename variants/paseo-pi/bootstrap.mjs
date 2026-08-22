import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

const stateRoot = process.env.MEWA_STATE_DIR ?? "/home/data";
const piDir = process.env.PI_CODING_AGENT_DIR ?? join(stateRoot, "pi");
const piSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR ?? join(piDir, "sessions");
const paseoHome = process.env.PASEO_HOME ?? join(stateRoot, "paseo");
const settingsPath = join(piDir, "settings.json");
const agentsRoot = process.env.MEWA_AGENTS_ROOT ?? "/home/core/agents";
const agentRulesFile = process.env.MEWA_AGENT_RULES_FILE ?? join(agentsRoot, "AGENTS.md");
const agentSkillsDir = process.env.MEWA_AGENT_SKILLS_DIR ?? join(agentsRoot, "skills");
const bundledExtensions = [
  "/opt/mewa/dist/pi/extensions/mewa-remote.js",
  "/opt/mewa/dist/pi/extensions/mewa-browser.js",
  "/opt/mewa/dist/pi/extensions/mewa-question.js",
  "/opt/mewa/dist/pi/extensions/mewa-plan.js",
];

for (const required of [
  "PASEO_PASSWORD",
  "MEWA_SSH_HOST",
  "MEWA_SSH_USER",
  "MEWA_SSH_PRIVATE_KEY",
  "MEWA_SSH_KNOWN_HOST",
  "MEWA_BROWSER_TOKEN",
]) {
  if (!process.env[required]) throw new Error(`${required} must be configured`);
}

for (const path of [
  stateRoot,
  piDir,
  piSessionDir,
  paseoHome,
  process.env.XDG_CONFIG_HOME,
  process.env.XDG_DATA_HOME,
  process.env.XDG_STATE_HOME,
  process.env.XDG_CACHE_HOME,
  process.env.NPM_CONFIG_CACHE,
  process.env.COREPACK_HOME,
].filter((value) => typeof value === "string" && value.length > 0)) {
  await mkdir(path, { recursive: true, mode: 0o700 });
}

let settings = {};
try {
  settings = JSON.parse(await readFile(settingsPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
  throw new Error(`${settingsPath} must contain a JSON object`);
}

settings.defaultThinkingLevel ??= "medium";
settings.defaultProjectTrust ??= "always";
settings.enableInstallTelemetry ??= false;
settings.enableAnalytics ??= false;
settings.enableSkillCommands ??= true;
settings.sessionDir ??= piSessionDir;
settings.compaction = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
  ...(isRecord(settings.compaction) ? settings.compaction : {}),
};
settings.retry = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2_000,
  ...(isRecord(settings.retry) ? settings.retry : {}),
};
settings.extensions = mergeStringEntries(settings.extensions, bundledExtensions);
if (await exists(agentSkillsDir)) settings.skills = mergeStringEntries(settings.skills, [agentSkillsDir]);

const temporary = join(dirname(settingsPath), `.settings.${process.pid}.tmp`);
await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o600,
});
await rename(temporary, settingsPath);

if (await exists(agentRulesFile)) {
  await ensureManagedSymlink(join(piDir, "AGENTS.md"), agentRulesFile);
}

const serverEntry = (await readFile("/etc/paseo-server-entry", "utf8")).trim();
if (!serverEntry) throw new Error("Paseo server entry is empty");
const child = spawn(process.execPath, [serverEntry], { stdio: "inherit", env: process.env });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error("[mewa-paseo] failed to start Paseo", error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeStringEntries(current, required) {
  const entries = Array.isArray(current) ? current : [];
  const strings = new Set(entries.filter((entry) => typeof entry === "string"));
  for (const entry of required) strings.add(entry);
  return [...entries.filter((entry) => typeof entry !== "string"), ...strings];
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

async function ensureManagedSymlink(linkPath, targetPath) {
  try {
    const info = await lstat(linkPath);
    if (!info.isSymbolicLink()) return;
    if ((await readlink(linkPath)) === targetPath) return;
    await unlink(linkPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await symlink(targetPath, linkPath);
}
