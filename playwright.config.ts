import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import {
	E2E_DATA_DIR,
	E2E_EDITOR_LOG,
	E2E_FAKE_BIN_DIR,
	E2E_HOME_DIR,
	E2E_PI_AGENT_DIR,
	E2E_PICK_DIR_POINTER,
	E2E_PORT,
} from "./e2e/fixtures/paths";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const staticDir = fileURLToPath(new URL("./apps/web/dist", import.meta.url));
// Per-worktree derived port (e2e/fixtures/paths.ts) — parallel worktrees (this product's own working
// model) run their suites concurrently without fighting over one port, zero config; the dev host
// (24242) stays clear. Slot clashes are auto-arbitrated by an atomic claim registry
// (e2e/fixtures/portBlock.ts). Supersedes the manual MEWA_CODE_E2E_PORT knob
// (MEWA_CODE_E2E_PORT_BASE pins the whole per-worktree block explicitly when ever needed).
const PORT = E2E_PORT;
const bunExecutable = (process.env.PATH ?? "")
	.split(delimiter)
	.map((directory) => join(directory, "bun"))
	.find(existsSync);
if (!bunExecutable) throw new Error("bun executable not found for the e2e host");
const hostPath = [E2E_FAKE_BIN_DIR, "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter);
if (hostPath.split(delimiter).some((directory) => existsSync(join(directory, "pi"))))
	throw new Error("e2e host PATH must not contain pi");
const isShardLane = process.env.MEWA_CODE_E2E_LANE !== undefined;
const hostCommand =
	process.env.MEWA_CODE_E2E_SKIP_BUILD === "1"
		? `${JSON.stringify(bunExecutable)} packages/server/src/dev.ts`
		: `${JSON.stringify(bunExecutable)} run build:web && ${JSON.stringify(bunExecutable)} packages/server/src/dev.ts`;
export default defineConfig({
	testDir: "./e2e",
	// One worker owns one stateful host. Shard lanes stay serial internally; fullyParallel only lets
	// Playwright distribute individual tests (rather than uneven whole files) across separate processes.
	fullyParallel: isShardLane,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	timeout: 30_000,
	reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	// Self-contained: build the web app, boot the host on an isolated port + state dir, and tear it all
	// down after. `bun run e2e` needs nothing else running.
	webServer: {
		command: hostCommand,
		cwd: rootDir,
		url: `http://localhost:${PORT}/health`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			MEWA_CODE_PORT: String(PORT),
			MEWA_CODE_STATIC_DIR: staticDir,
			MEWA_CODE_DATA_DIR: E2E_DATA_DIR,
			// Stub the host's native directory picker so "Open project" is drivable headlessly. It names a
			// control *file* (seeded to the git fixture in globalSetup); a test can rewrite it to hand the
			// picker a different folder (e.g. a non-git one) without restarting the shared host.
			MEWA_CODE_PICK_DIR: E2E_PICK_DIR_POINTER,
			// Force the New-Workspace dialog's `gh` probe to "Not connected" so the suite is deterministic
			// regardless of the dev machine's real `gh` auth — and exercises the offline/local-branch degrade path.
			MEWA_CODE_GH_OFFLINE: "1",
			// Keep cross-agent personal skill aliases away from the developer's real homes/overrides.
			HOME: E2E_HOME_DIR,
			USERPROFILE: E2E_HOME_DIR,
			CLAUDE_CONFIG_DIR: `${E2E_HOME_DIR}/.claude`,
			CODEX_HOME: `${E2E_HOME_DIR}/.codex`,
			GEMINI_CLI_HOME: E2E_HOME_DIR,
			// Point pi at an ISOLATED agent dir (seeded with a copy of the user's auth in globalSetup), so the
			// @agent suite uses a real provider yet `setModel`/`setThinkingLevel` persist here — never the
			// user's real `~/.pi/agent`. (Provider env vars in the inherited env still resolve auth too.)
			PI_CODING_AGENT_DIR: E2E_PI_AGENT_DIR,
			// Keep the suite hermetic: `model.list` fires a detached pi.dev catalog refresh (issue #98) that
			// must never leave the machine in tests — PI_OFFLINE is pi's own convention and our guard honors it.
			PI_OFFLINE: "1",
			// Lane-local `code` stub: deterministic and safe under process-level sharding.
			PATH: hostPath,
			// Where the stub `code` appends each invocation's argv, so a test can assert "Open in VS Code"
			// actually launched with the right worktree path.
			MEWA_CODE_E2E_EDITOR_LOG: E2E_EDITOR_LOG,
			// Register a deterministic fake OAuth provider (`e2e-oauth`) so the in-app login flow is drivable
			// end-to-end without a real provider/browser (see packages/server/src/dev.ts).
			MEWA_CODE_E2E_FAKE_OAUTH: "1",
		},
	},
});
