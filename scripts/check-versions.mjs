import { readFile } from "node:fs/promises";

const versions = Object.fromEntries(
  (await readFile(new URL("../versions.env", import.meta.url), "utf8"))
    .trim()
    .split("\n")
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=", 2)),
);

const codePackage = JSON.parse(
  await readFile(new URL("../mewa-code/package.json", import.meta.url), "utf8"),
);
const browserPackage = JSON.parse(
  await readFile(new URL("../mewa-browser/package.json", import.meta.url), "utf8"),
);
const codeDockerfile = await readFile(
  new URL("../mewa-code/Dockerfile", import.meta.url),
  "utf8",
);
const browserDockerfile = await readFile(
  new URL("../mewa-browser/Dockerfile", import.meta.url),
  "utf8",
);
const piProviderRoot = new URL(
  "../mewa-code/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/",
  import.meta.url,
);

if (versions.PI_VERSION !== codePackage.devDependencies["@earendil-works/pi-coding-agent"]) {
  throw new Error(
    `PI_VERSION=${versions.PI_VERSION} does not match package version ${codePackage.devDependencies["@earendil-works/pi-coding-agent"]}`,
  );
}
for (const [name, actual] of [
  ["PI_MCP_ADAPTER_VERSION", codePackage.dependencies["pi-mcp-adapter"]],
  ["PI_SUBAGENTS_VERSION", codePackage.dependencies["pi-subagents"]],
  ["SIGNET_CONNECTOR_VERSION", codePackage.devDependencies["@signetai/connector-pi"]],
]) {
  if (versions[name] !== actual) {
    throw new Error(`${name}=${versions[name]} does not match package version ${actual}`);
  }
}
if (codePackage.dependencies.typebox !== "1.1.38") {
  throw new Error("mewa-code typebox must stay aligned with Pi 0.81.1");
}
for (const [file, markers] of [
  ["openai-codex.js", ['id: "openai-codex"', "OpenAI (ChatGPT Plus/Pro)"]],
  ["opencode.js", ['id: "opencode"', "OPENCODE_API_KEY"]],
  ["opencode-go.js", ['id: "opencode-go"', "OPENCODE_API_KEY"]],
]) {
  const source = await readFile(new URL(file, piProviderRoot), "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`Pi provider ${file} is missing ${marker}`);
  }
}
if (browserPackage.dependencies?.["agent-browser"] !== undefined) {
  throw new Error("mewa-browser must use the pinned native binary, not the npm lifecycle package");
}

for (const [name, dockerfile] of [
  ["mewa-code", codeDockerfile],
  ["mewa-browser", browserDockerfile],
]) {
  if (!dockerfile.includes(`ARG NODE_VERSION=${versions.NODE_VERSION}`)) {
    throw new Error(`${name} Dockerfile does not use NODE_VERSION=${versions.NODE_VERSION}`);
  }
}

for (const [name, value] of [
  ["BUN_VERSION", versions.BUN_VERSION],
  ["SYNARA_VERSION", versions.SYNARA_VERSION],
]) {
  if (!codeDockerfile.includes(`ARG ${name}=${value}`)) {
    throw new Error(`mewa-code Dockerfile does not use ${name}=${value}`);
  }
}
if (!codeDockerfile.includes("synara/archive/refs/tags/v${SYNARA_VERSION}.tar.gz")) {
  throw new Error("mewa-code must build Synara from the pinned tagged source archive");
}
if (!codeDockerfile.includes("sha256sum --check --strict")) {
  throw new Error("mewa-code must verify the Synara source archive checksum");
}
if (!codeDockerfile.includes("bun run build --filter=@synara/web --filter=@synara/cli")) {
  throw new Error("mewa-code must use Synara's release build targets");
}
if (!codeDockerfile.includes("bun install --frozen-lockfile --ignore-scripts --filter @synara/cli --omit dev")) {
  throw new Error("mewa-code must prune Synara to its locked CLI runtime dependency set");
}
if (codeDockerfile.includes("--linker hoisted")) {
  throw new Error("mewa-code must preserve Synara's isolated dependency linker");
}
for (const forbidden of [
  "COPY --from=synara-build /src/synara/packages",
  "COPY --from=synara-build /src/synara/apps/server/src",
  "    ripgrep \\",
]) {
  if (codeDockerfile.includes(forbidden)) {
    throw new Error(`mewa-code final image still contains obsolete layout: ${forbidden}`);
  }
}
if (!codeDockerfile.includes("/src/synara/apps/server/node_modules ./node_modules")) {
  throw new Error("mewa-code must preserve Synara's isolated server dependency links");
}
if (!browserDockerfile.includes(`ARG AGENT_BROWSER_VERSION=${versions.AGENT_BROWSER_VERSION}`)) {
  throw new Error(
    `mewa-browser Dockerfile does not use AGENT_BROWSER_VERSION=${versions.AGENT_BROWSER_VERSION}`,
  );
}
if (!browserDockerfile.includes("sha256sum --check")) {
  throw new Error("mewa-browser must verify the agent-browser binary checksum");
}
if (codePackage.dependencies["@synara/cli"] !== undefined) {
  throw new Error("mewa-code must not depend on the optional Synara npm publication");
}

console.log("version and runtime metadata are consistent");
