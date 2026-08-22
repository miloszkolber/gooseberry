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

if (versions.PI_VERSION !== codePackage.dependencies["@earendil-works/pi-coding-agent"]) {
  throw new Error(
    `PI_VERSION=${versions.PI_VERSION} does not match package version ${codePackage.dependencies["@earendil-works/pi-coding-agent"]}`,
  );
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

if (!codeDockerfile.includes(`ARG SYNARA_VERSION=${versions.SYNARA_VERSION}`)) {
  throw new Error(`mewa-code Dockerfile does not use SYNARA_VERSION=${versions.SYNARA_VERSION}`);
}
if (!browserDockerfile.includes(`ARG AGENT_BROWSER_VERSION=${versions.AGENT_BROWSER_VERSION}`)) {
  throw new Error(
    `mewa-browser Dockerfile does not use AGENT_BROWSER_VERSION=${versions.AGENT_BROWSER_VERSION}`,
  );
}
if (codePackage.dependencies["@synara/cli"] !== undefined) {
  throw new Error("mewa-code must consume Synara's published server artifact, not an npm dependency");
}

console.log("version metadata is consistent");
