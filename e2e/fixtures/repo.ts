import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_FIXTURE_REPO } from "./paths";

export function fixtureRepoHealthy(): boolean {
	try {
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, "rev-parse", "--git-dir"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function seedFixtureRepo(): void {
	mkdirSync(E2E_FIXTURE_REPO, { recursive: true });
	const git = (...args: string[]) =>
		execFileSync("git", ["-C", E2E_FIXTURE_REPO, ...args], { stdio: "ignore" });
	git("init", "-b", "main");
	git("config", "user.email", "e2e@mewa-code.test");
	git("config", "user.name", "Mewa Code E2E");
	writeFileSync(join(E2E_FIXTURE_REPO, "README.md"), "# sample-project\n");
	writeFileSync(join(E2E_FIXTURE_REPO, "notes.txt"), "plain-text-fixture\n");
	writeFileSync(
		join(E2E_FIXTURE_REPO, "ALERTS.md"),
		[
			"# Alert callouts",
			"",
			"> [!NOTE]",
			"> Useful information users should know.",
			"",
			"> [!TIP]",
			"> Helpful advice for doing things better.",
			"",
			"> [!IMPORTANT]",
			"> Key information to achieve a goal.",
			"",
			"> [!WARNING]",
			"> Urgent info needing immediate attention.",
			"",
			"> [!CAUTION]",
			"> Advises about risky outcomes.",
			"",
			"> A plain blockquote, no marker, so it stays a quote.",
			"",
		].join("\n"),
	);
	writeFileSync(join(E2E_FIXTURE_REPO, "LARGE.md"), largeRepetitiveMarkdown());
	writeFileSync(
		join(E2E_FIXTURE_REPO, "LINKS.md"),
		[
			"# Link demo",
			"",
			"Jump to [Section two](#section-two), open [the README](README.md), and see the logo:",
			"",
			"![logo](logo.png)",
			"",
			"## Section two",
			"",
			"Target of the in-document anchor.",
			"",
		].join("\n"),
	);
	writeFileSync(
		join(E2E_FIXTURE_REPO, "logo.png"),
		Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGB9x0AAAAASUVORK5CYII=",
			"base64",
		),
	);
	const skillDir = join(E2E_FIXTURE_REPO, ".claude", "skills", "e2e-portable");
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, "SKILL.md"),
		"---\nname: e2e-portable\ndescription: Portable e2e fixture skill\n---\n\n# Portable skill\n",
	);
	git("add", "-A");
	git("commit", "-m", "init");
}

export function largeRepetitiveMarkdown(): string {
	const rows = Array.from({ length: 800 }, () => "- alpha beta gamma delta epsilon");
	return `# Large repetitive doc\n\n${rows.join("\n")}\n`;
}

export function largeRepetitiveMarkdownEdited(): string {
	const lines = largeRepetitiveMarkdown().split("\n");
	lines[400] = "- EDITED replacement row";
	return `${lines.join("\n")}- appended row by e2e\n`;
}
