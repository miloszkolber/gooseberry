import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, type Project } from "@mewa-code/contracts";
import { loadConfig, loadProjects, saveConfig, saveProjects } from "./persistence";

let root: string;
const previousDataDir = process.env.MEWA_CODE_DATA_DIR;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "mewa-code-persistence-"));
	process.env.MEWA_CODE_DATA_DIR = root;
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
});

const project = (id: string): Project => ({
	id,
	name: id,
	roots: [`/repos/${id}`],
	slug: id,
	lastOpened: 1,
});

test("core JSON stores replace atomically and recover a valid backup", () => {
	const first = [project("first")];
	saveProjects(first);
	saveProjects([project("second")]);
	writeFileSync(join(root, "projects.json"), "{ malformed");
	expect(loadProjects()).toEqual(first);
	expect(JSON.parse(readFileSync(join(root, "projects.json.bak"), "utf8"))).toEqual(first);
	saveConfig({ ...DEFAULT_CONFIG, signet: { enabled: true, address: "signet", port: 3850 } });
	saveConfig(DEFAULT_CONFIG);
	writeFileSync(join(root, "config.json"), "not json");
	expect(loadConfig().signet.enabled).toBe(true);
});

test("legacy one-path projects migrate to roots", () => {
	writeFileSync(
		join(root, "projects.json"),
		JSON.stringify([{ id: "old", name: "old", path: "/repos/old", slug: "old", lastOpened: 1 }]),
	);
	expect(loadProjects()[0]?.roots).toEqual(["/repos/old"]);
	expect(readFileSync(join(root, "projects.json"), "utf8")).not.toContain('"path"');
});

test("serialization and size failures preserve the last valid value", () => {
	const initial = [project("keep")];
	saveProjects(initial);
	const cyclic = project("broken") as Project & { self?: unknown };
	cyclic.self = cyclic;
	expect(() => saveProjects([cyclic])).toThrow();
	expect(loadProjects()).toEqual(initial);
	const oversized = project("oversized");
	oversized.name = "x".repeat(16 * 1024 * 1024);
	expect(() => saveProjects([oversized])).toThrow("Persisted JSON exceeds");
	expect(existsSync(join(root, ".projects.json"))).toBe(false);
});

test("model visibility and legacy Signet state migrate independently from Pi", () => {
	writeFileSync(
		join(root, "config.json"),
		JSON.stringify({
			piProfile: { signetMemory: true },
			browserEnabled: false,
			goalsEnabled: false,
			hiddenModels: [
				{ provider: "alpha", id: "one" },
				{ provider: "alpha", id: "one" },
			],
		}),
	);
	const config = loadConfig();
	expect(config.signet).toEqual({ enabled: true, address: "127.0.0.1", port: 3850 });
	expect(config.hiddenModels).toEqual([{ provider: "alpha", id: "one" }]);
	expect(Object.keys(config).sort()).toEqual(["hiddenModels", "signet"]);
});
