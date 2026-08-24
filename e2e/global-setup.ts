import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	E2E_DATA_DIR,
	E2E_FAKE_BIN_DIR,
	E2E_FIXTURE_REPO,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PI_MODELS_SEED,
	E2E_PICK_DIR_POINTER,
} from "./fixtures/paths";
import { seedFixtureRepo } from "./fixtures/repo";
import { seedExternalCwdSessions } from "./fixtures/sessions";
import { seedTemplateFixtures } from "./fixtures/templates";

export default function globalSetup(): void {
	rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	mkdirSync(E2E_DATA_DIR, { recursive: true });
	mkdirSync(E2E_HOME_DIR, { recursive: true });
	writeFileSync(join(E2E_HOME_DIR, ".zshrc"), "# Mewa Code e2e isolated shell\n");

	for (const rc of [".zshrc", ".bashrc"]) writeFileSync(join(E2E_HOME_DIR, rc), "");

	mkdirSync(E2E_FAKE_BIN_DIR, { recursive: true });
	for (const command of ["code"]) {
		const target = join(E2E_FAKE_BIN_DIR, command);
		copyFileSync(new URL(`./fixtures/bin/${command}`, import.meta.url), target);
		chmodSync(target, 0o755);
	}
	mkdirSync(E2E_PI_AGENT_DIR, { recursive: true });
	const userAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	for (const file of ["auth.json", "models.json"]) {
		const src = join(userAgentDir, file);
		if (existsSync(src)) copyFileSync(src, join(E2E_PI_AGENT_DIR, file));
	}
	const modelsSeedSrc = join(userAgentDir, "models.json");
	if (existsSync(modelsSeedSrc)) copyFileSync(modelsSeedSrc, E2E_PI_MODELS_SEED);
	else rmSync(E2E_PI_MODELS_SEED, { force: true });
	const [provider, ...idParts] = (
		process.env.MEWA_CODE_E2E_MODEL ?? "anthropic/claude-opus-4-8"
	).split("/");
	writeFileSync(
		join(E2E_PI_AGENT_DIR, "settings.json"),
		`${JSON.stringify({ defaultProvider: provider, defaultModel: idParts.join("/"), defaultThinkingLevel: "low" }, null, 2)}\n`,
	);

	seedExternalCwdSessions();

	seedTemplateFixtures();

	seedFixtureRepo();

	writeFileSync(E2E_PICK_DIR_POINTER, E2E_FIXTURE_REPO);
}
