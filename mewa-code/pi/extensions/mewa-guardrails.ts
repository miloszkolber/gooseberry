import { lstat, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";

const recursivePathTools = new Set(["find", "grep"]);
const directPathTools = new Set(["edit", "ls", "read", "write"]);
const shellPathPattern = /(?:^|[\s;&|()<>])((?:"(?:\\.|[^"])*"|'[^']*'|\\.|[^\s;&|()<>])+)/g;

type GuardDecision = { blocked: boolean; path?: string };

export function parseRestrictedPaths(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const paths = value
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const path of paths) {
    if (!isAbsolute(path)) throw new Error(`MEWA_RESTRICTED_PATHS entries must be absolute: ${path}`);
  }
  return [...new Set(paths.map((path) => resolve(path)))];
}

export function pathOverlapsRoot(path: string, root: string, includeAncestors = false): boolean {
  return isWithin(root, path) || (includeAncestors && isWithin(path, root));
}

export function shellPathCandidates(command: string, cwd: string): string[] {
  const candidates: string[] = [];
  for (const match of command.matchAll(shellPathPattern)) {
    const token = unquoteShellWord(match[1] ?? "");
    if (!token || token.startsWith("-") || token.includes("$")) continue;
    if (token === "." || token === ".." || token.startsWith("./") || token.startsWith("../") || isAbsolute(token)) {
      candidates.push(resolve(cwd, token));
    }
  }
  return candidates;
}

export default function mewaGuardrails(pi: ExtensionAPI): void {
  const configuredRoots = parseRestrictedPaths(process.env.MEWA_RESTRICTED_PATHS);
  if (configuredRoots.length === 0) return;

  let rootsPromise: Promise<string[]> | undefined;
  const roots = () => rootsPromise ??= Promise.all(configuredRoots.map(canonicalize));

  pi.on("tool_call", async (event, ctx) => {
    const restrictedRoots = await roots();
    const decision = await inspectToolCall(event, ctx.cwd, restrictedRoots);
    if (!decision.blocked) return;

    const reason = decision.path
      ? `Access to restricted path is blocked: ${decision.path}`
      : "The shell command may access a restricted path and was blocked.";
    if (ctx.hasUI) ctx.ui.notify(reason, "warning");
    return { block: true, reason };
  });
}

async function inspectToolCall(
  event: ToolCallEvent,
  cwd: string,
  restrictedRoots: string[],
): Promise<GuardDecision> {
  if (directPathTools.has(event.toolName) || recursivePathTools.has(event.toolName)) {
    const input = event.input as { path?: unknown };
    const candidate = typeof input.path === "string" ? input.path : ".";
    const canonical = await canonicalize(resolve(cwd, candidate));
    const includeAncestors = recursivePathTools.has(event.toolName);
    if (restrictedRoots.some((root) => pathOverlapsRoot(canonical, root, includeAncestors))) {
      return { blocked: true, path: candidate };
    }
    return { blocked: false };
  }

  if (event.toolName !== "bash") return { blocked: false };
  const command = (event.input as { command?: unknown }).command;
  if (typeof command !== "string") return { blocked: false };

  const canonicalCwd = await canonicalize(cwd);
  if (restrictedRoots.some((root) => isWithin(root, canonicalCwd))) {
    return { blocked: true, path: cwd };
  }

  for (const root of restrictedRoots) {
    if (command.includes(root)) return { blocked: true, path: root };
  }

  const protectedEnvironmentPaths = [
    ["HOME", process.env.HOME],
    ["PI_CODING_AGENT_DIR", process.env.PI_CODING_AGENT_DIR],
    ["XDG_CONFIG_HOME", process.env.XDG_CONFIG_HOME],
    ["XDG_DATA_HOME", process.env.XDG_DATA_HOME],
    ["XDG_STATE_HOME", process.env.XDG_STATE_HOME],
  ] as const;
  for (const [name, value] of protectedEnvironmentPaths) {
    if (!value) continue;
    const canonical = await canonicalize(value);
    if (!restrictedRoots.some((root) => pathOverlapsRoot(canonical, root))) continue;
    if (command.includes(`$${name}`) || command.includes(`\${${name}}`)) {
      return { blocked: true, path: `$${name}` };
    }
  }

  for (const candidate of shellPathCandidates(command, cwd)) {
    const canonical = await canonicalize(candidate);
    if (restrictedRoots.some((root) => pathOverlapsRoot(canonical, root, true))) {
      return { blocked: true, path: candidate };
    }
  }

  return { blocked: false };
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
}

function unquoteShellWord(value: string): string {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value.replace(/\\(.)/g, "$1");
}

async function canonicalize(path: string): Promise<string> {
  const absolute = resolve(path);
  let probe = absolute;
  const suffix: string[] = [];
  for (;;) {
    try {
      await lstat(probe);
      const canonical = await realpath(probe);
      return resolve(canonical, ...suffix.reverse());
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        const parent = resolve(probe, "..");
        if (parent === probe) return absolute;
        suffix.push(relative(parent, probe));
        probe = parent;
        continue;
      }
      throw error;
    }
  }
}
