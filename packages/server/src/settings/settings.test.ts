import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, DEFAULT_PI_PROFILE_SETTINGS } from "@mewa-code/contracts";
import { getConfig, resetConfigCache, setSettingsPublisher, updateConfig } from "./settings";

let dataDir: string;
const savedDataDir = process.env.MEWA_CODE_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-settings-test-"));
	process.env.MEWA_CODE_DATA_DIR = dataDir;
	resetConfigCache();
});

afterEach(() => {
	setSettingsPublisher(null);
	resetConfigCache();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
	else process.env.MEWA_CODE_DATA_DIR = savedDataDir;
});

test("getConfig falls back to DEFAULT_CONFIG when no config.json exists", () => {
	expect(getConfig()).toEqual(DEFAULT_CONFIG);
});

test("updateConfig merges, persists an opaque theme id, and returns the merged config", () => {
	const opaqueTheme = "acme.solarized";
	const next = updateConfig({ theme: opaqueTheme });
	expect(next.theme).toBe(opaqueTheme);
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
	expect(onDisk.theme).toBe(opaqueTheme);
	expect(getConfig().theme).toBe(opaqueTheme);
});

test("updateConfig broadcasts the new config through the injected publisher", () => {
	const seen: string[] = [];
	setSettingsPublisher((c) => seen.push(c.theme));
	updateConfig({ theme: "acme.broadcast" });
	expect(seen).toEqual(["acme.broadcast"]);
});

test("a null publisher makes updates silent no-ops (still persisted)", () => {
	setSettingsPublisher(null);
	expect(() => updateConfig({ theme: "acme.silent" })).not.toThrow();
	expect(existsSync(join(dataDir, "config.json"))).toBe(true);
});

test("loadConfig degrades a partial/corrupt file over DEFAULT_CONFIG", () => {
	writeFileSync(join(dataDir, "config.json"), "{ not json");
	resetConfigCache();
	expect(getConfig()).toEqual(DEFAULT_CONFIG);
});

test("an older host preserves unknown top-level config extensions when updating a known field", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, futureSetting: { mode: "new" } }),
	);
	resetConfigCache();
	updateConfig({ theme: "acme.changed" });
	const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
	expect(onDisk.futureSetting).toEqual({ mode: "new" });
});

test("loadConfig drops the removed shared layout setting", () => {
	writeFileSync(
		join(dataDir, "config.json"),
		JSON.stringify({ ...DEFAULT_CONFIG, layout: { defaultPresetId: "balanced" } }),
	);
	resetConfigCache();
	expect(getConfig()).toEqual(DEFAULT_CONFIG);
});

test("defaults the curated Pi profile to enabled non-safety capabilities", () => {
	expect(getConfig().piProfile).toEqual(DEFAULT_PI_PROFILE_SETTINGS);
});

test("persists nested Pi profile choices without creating a disable switch for the safety guard", () => {
	const next = updateConfig({ piProfile: { browser: false, goals: false } });
	expect(next.piProfile).toEqual({
		...DEFAULT_PI_PROFILE_SETTINGS,
		browser: false,
		goals: false,
	});
	expect(JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")).piProfile).toEqual({
		...DEFAULT_PI_PROFILE_SETTINGS,
		browser: false,
		goals: false,
	});
	resetConfigCache();
	expect(getConfig().piProfile).toEqual({
		...DEFAULT_PI_PROFILE_SETTINGS,
		browser: false,
		goals: false,
	});
});
