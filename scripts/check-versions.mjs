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

const expectations = [
  ["SYNARA_VERSION", codePackage.dependencies["@synara/cli"]],
  ["PI_VERSION", codePackage.dependencies["@earendil-works/pi-coding-agent"]],
  ["AGENT_BROWSER_VERSION", browserPackage.dependencies["agent-browser"]],
];
for (const [name, actual] of expectations) {
  if (versions[name] !== actual) {
    throw new Error(`${name}=${versions[name]} does not match package version ${actual}`);
  }
}
for (const [name, dockerfile] of [
  ["mewa-code", codeDockerfile],
  ["mewa-browser", browserDockerfile],
]) {
  if (!dockerfile.includes(`ARG NODE_VERSION=${versions.NODE_VERSION}`)) {
    throw new Error(`${name} Dockerfile does not use NODE_VERSION=${versions.NODE_VERSION}`);
  }
}

console.log("version metadata is consistent");
