import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { resetConfigCache, updateConfig } from "../settings";
import {
	buildResourceLoader,
	getPiProfile,
	listSkillCatalog,
	listSkillCommands,
} from "./extensions";
import type { SkillAdmissionContext } from "./skillAdmission";

function ctx(
	trusted: boolean,
	overrides: Partial<SkillAdmissionContext> = {},
): SkillAdmissionContext {
	return {
		trusted,
		disabled: [],
		disabledGroups: [],
		overrides: {},
		...overrides,
	};
}

function writeSkill(root: string, name: string, description: string): void {
	const directory = join(root, name);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nPortable fixture.\n`,
	);
}

function withPiEnvironment(home: string, agentDir: string): () => void {
	const names = ["HOME", "PI_CODING_AGENT_DIR", "SIGNET_DAEMON_URL"];
	const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	delete process.env.SIGNET_DAEMON_URL;
	return () => {
		for (const [name, value] of Object.entries(original)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	};
}

describe("listSkillCommands", () => {
	it("lists native Pi user and project skills with project trust gating", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-native-skills-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);

		try {
			writeSkill(join(project, ".pi", "skills"), "repo-native", "native repo skill");
			writeSkill(join(agentDir, "skills"), "personal-native", "native personal skill");

			const untrusted = await listSkillCommands(project, ctx(false));
			expect(untrusted.map((command) => command.name)).toEqual(["skill:personal-native"]);
			expect(untrusted[0]?.sourceInfo).toMatchObject({ source: "auto", scope: "user" });

			const trusted = await listSkillCommands(project, ctx(true));
			expect(trusted.map((command) => command.name).sort()).toEqual([
				"skill:personal-native",
				"skill:repo-native",
			]);
			expect(
				trusted.find((command) => command.name === "skill:repo-native")?.sourceInfo,
			).toMatchObject({
				source: "auto",
				scope: "project",
			});
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("applies project and workspace skill toggles to native Pi skills", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-native-skill-toggles-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);

		try {
			writeSkill(join(project, ".pi", "skills"), "repo-native", "native repo skill");
			writeSkill(join(agentDir, "skills"), "personal-native", "native personal skill");

			const disabled = await listSkillCommands(project, ctx(true, { disabledGroups: ["project"] }));
			expect(disabled).toEqual([
				{
					name: "skill:personal-native",
					description: "native personal skill",
					source: "skill",
					sourceInfo: expect.any(Object),
				},
			]);
			// The project skill is hidden by the project group, while a workspace
			// override can explicitly re-enable it.
			const reenabled = await listSkillCommands(
				project,
				ctx(true, { disabledGroups: ["project"], overrides: { "repo-native": "on" } }),
			);
			expect(reenabled.some((command) => command.name === "skill:repo-native")).toBe(true);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("listSkillCatalog", () => {
	it("reports native project skills as gated without inventing compatibility aliases", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-native-catalog-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);

		try {
			writeSkill(join(project, ".pi", "skills"), "repo-native", "native repo skill");
			writeSkill(join(agentDir, "skills"), "personal-native", "native personal skill");

			const catalog = await listSkillCatalog(project, ctx(false));
			expect(catalog).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "repo-native",
						gated: true,
						group: "project",
						decision: "untrusted",
					}),
					expect.objectContaining({
						name: "personal-native",
						gated: false,
						group: "personal",
						decision: "load",
					}),
				]),
			);
			expect(
				catalog.some((entry) => entry.name.includes("claude") || entry.name.includes("codex")),
			).toBe(false);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("buildResourceLoader", () => {
	it("loads the curated Pi extensions, including browser and subagent tools", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-extension-profile-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);

		try {
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const tools = new Set(
				loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]),
			);
			expect(tools.has("browser")).toBe(true);
			expect(tools.has("web_search")).toBe(true);
			expect(tools.has("fetch_content")).toBe(true);
			expect(tools.has("subagent")).toBe(true);
			expect(tools.has("subagent_wait")).toBe(true);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("loads Signet only when SIGNET_DAEMON_URL is configured", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-signet-extension-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);

		try {
			process.env.SIGNET_DAEMON_URL = "http://127.0.0.1:3850";
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const tools = new Set(
				loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]),
			);
			expect(tools.has("signet_recall")).toBe(true);
			expect(tools.has("signet_source_search")).toBe(true);
			expect(tools.has("signet_session_search")).toBe(true);
			expect(tools.has("signet_remember")).toBe(true);
			expect(existsSync(join(agentDir, "extensions", "signet-pi.js"))).toBe(true);
			expect(existsSync(join(agentDir, "memory.db"))).toBe(false);

			delete process.env.SIGNET_DAEMON_URL;
			const disabledSettings = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const disabledLoader = await buildResourceLoader(project, disabledSettings, () => ctx(true));
			const disabledTools = new Set(
				disabledLoader
					.getExtensions()
					.extensions.flatMap((extension) => [...extension.tools.keys()]),
			);
			expect(disabledTools.has("signet_recall")).toBe(false);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reloads native project skills when trust changes", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-native-skill-reload-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);

		try {
			writeSkill(join(project, ".pi", "skills"), "repo-native", "native repo skill");
			let admission = ctx(false);
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => admission);
			expect(loader.getSkills().skills.some((skill) => skill.name === "repo-native")).toBe(false);

			admission = ctx(true);
			const trustedSettings = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const trustedLoader = await buildResourceLoader(project, trustedSettings, () => admission);
			expect(trustedLoader.getSkills().skills.some((skill) => skill.name === "repo-native")).toBe(
				true,
			);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not execute project extensions while listing native skills", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-skill-listing-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const marker = join(root, "extension-executed");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);

		try {
			writeSkill(join(project, ".pi", "skills"), "repo-native", "native repo skill");
			const extensionDir = join(project, ".pi", "extensions");
			mkdirSync(extensionDir, { recursive: true });
			writeFileSync(
				join(extensionDir, "probe.ts"),
				`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport default () => {};\n`,
			);
			await listSkillCommands(project, ctx(true));
			expect(existsSync(marker)).toBe(false);
		} finally {
			restore();
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("reports unavailable optional Signet memory without blocking the curated profile", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-pi-profile-state-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const dataDir = join(root, "mewa-data");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);
		const previousDataDir = process.env.MEWA_CODE_DATA_DIR;
		process.env.MEWA_CODE_DATA_DIR = dataDir;
		resetConfigCache();

		try {
			const profile = await getPiProfile();
			expect(profile.id).toBe("mewa");
			expect(profile.capabilities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: "browser", available: true, enabled: true }),
					expect.objectContaining({ id: "webAccess", available: true, enabled: true }),
					expect.objectContaining({
						id: "signetMemory",
						available: false,
						enabled: false,
						unavailableReason: "Signet memory is not configured.",
					}),
					expect.objectContaining({
						id: "protectedStateGuard",
						available: true,
						enabled: true,
						required: true,
					}),
				]),
			);
		} finally {
			restore();
			resetConfigCache();
			if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
			else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("honors disabled curated capabilities while keeping the protected-state guard immutable", async () => {
		const root = mkdtempSync(join(tmpdir(), "mewa-code-pi-profile-disabled-"));
		const project = join(root, "project");
		const home = join(root, "home");
		const agentDir = join(root, "pi-agent");
		const dataDir = join(root, "mewa-data");
		mkdirSync(project, { recursive: true });
		mkdirSync(home, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		const restore = withPiEnvironment(home, agentDir);
		const previousDataDir = process.env.MEWA_CODE_DATA_DIR;
		process.env.MEWA_CODE_DATA_DIR = dataDir;
		resetConfigCache();

		try {
			updateConfig({
				piProfile: { browser: false, webAccess: false, goals: false, subagents: false },
			});
			const settingsManager = SettingsManager.create(project, agentDir, { projectTrusted: true });
			const loader = await buildResourceLoader(project, settingsManager, () => ctx(true));
			const loadedPaths = new Set(
				loader.getExtensions().extensions.map((extension) => extension.path),
			);
			expect([...loadedPaths].some((path) => path.includes("pi-mewa-browser"))).toBe(false);
			expect([...loadedPaths].some((path) => path.includes("pi-web-access"))).toBe(false);
			expect([...loadedPaths].some((path) => path.includes("pi-subagents"))).toBe(false);
			expect([...loadedPaths].some((path) => path === "<inline:mewa-goals>")).toBe(false);

			const profile = await getPiProfile();
			expect(profile.capabilities).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: "browser", available: true, enabled: false }),
					expect.objectContaining({ id: "webAccess", available: true, enabled: false }),
					expect.objectContaining({ id: "goals", available: true, enabled: false }),
					expect.objectContaining({ id: "subagents", available: true, enabled: false }),
					expect.objectContaining({ id: "protectedStateGuard", enabled: true, required: true }),
				]),
			);

			updateConfig({ piProfile: { browser: true, webAccess: true, goals: true, subagents: true } });
			await loader.reload();
			expect(
				loader
					.getExtensions()
					.extensions.some((extension) => extension.path === "<inline:mewa-goals>"),
			).toBe(true);
			expect(
				[...loader.getExtensions().extensions].some((extension) =>
					extension.path.includes("pi-mewa-browser"),
				),
			).toBe(true);
			expect(
				[...loader.getExtensions().extensions].some((extension) =>
					extension.path.includes("pi-web-access"),
				),
			).toBe(true);
			expect(
				[...loader.getExtensions().extensions].some((extension) =>
					extension.path.includes("pi-subagents"),
				),
			).toBe(true);
		} finally {
			restore();
			resetConfigCache();
			if (previousDataDir === undefined) delete process.env.MEWA_CODE_DATA_DIR;
			else process.env.MEWA_CODE_DATA_DIR = previousDataDir;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
