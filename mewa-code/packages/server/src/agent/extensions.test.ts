import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { buildResourceLoader, listSkillCommands } from "./extensions";
import type { SkillAdmissionContext } from "./skill-admission";

function context(trusted: boolean): SkillAdmissionContext {
	return { trusted, disabled: [], disabledGroups: [], overrides: {} };
}

function writeSkill(root: string, name: string): void {
	const directory = join(root, name);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "SKILL.md"),
		`---\nname: ${name}\ndescription: ${name} skill\n---\n\nFocused fixture.\n`,
	);
}

function testEnvironment(root: string): () => void {
	const previous = {
		HOME: process.env.HOME,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
		SIGNET_DAEMON_URL: process.env.SIGNET_DAEMON_URL,
	};
	process.env.HOME = join(root, "home");
	process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
	delete process.env.SIGNET_DAEMON_URL;
	mkdirSync(process.env.HOME, { recursive: true });
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	return () => {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	};
}

test("loads the curated Pi extensions and inline goal/subagent extensions", async () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-extensions-"));
	const project = join(root, "project");
	mkdirSync(project, { recursive: true });
	const restore = testEnvironment(root);

	try {
		const settings = SettingsManager.create(project, process.env.PI_CODING_AGENT_DIR as string, {
			projectTrusted: true,
		});
		const loader = await buildResourceLoader(project, settings, () => context(true));
		const extensions = loader.getExtensions().extensions;
		const tools = new Set(extensions.flatMap((extension) => [...extension.tools.keys()]));

		for (const tool of ["browser", "web_search", "fetch_content", "subagent"])
			expect(tools.has(tool)).toBe(true);
		expect(extensions.some((extension) => extension.path === "<inline:mewa-goals>")).toBe(true);
		expect(extensions.some((extension) => extension.path === "<inline:mewa-subagents>")).toBe(true);
		expect(tools.has("subagent_wait")).toBe(false);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});

test("gates project skills on explicit project trust while keeping personal skills available", async () => {
	const root = mkdtempSync(join(tmpdir(), "mewa-code-skills-"));
	const project = join(root, "project");
	mkdirSync(project, { recursive: true });
	const restore = testEnvironment(root);

	try {
		writeSkill(join(project, ".pi", "skills"), "repo-native");
		writeSkill(join(process.env.PI_CODING_AGENT_DIR as string, "skills"), "personal-native");

		const untrusted = await listSkillCommands(project, context(false));
		const trusted = await listSkillCommands(project, context(true));
		expect(untrusted.map((command) => command.name)).toEqual(["skill:personal-native"]);
		expect(trusted.map((command) => command.name).sort()).toEqual([
			"skill:personal-native",
			"skill:repo-native",
		]);
	} finally {
		restore();
		rmSync(root, { recursive: true, force: true });
	}
});
