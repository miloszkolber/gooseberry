import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IMAGE_MAX_BASE64_BYTES } from "@gooseberry/contracts";
import { setMountedProjectRootsForTesting } from "../path-admission";
import { recordProjectSession, setDataDirForTests } from "../persistence";
import { resetConfigCache } from "../settings";
import { stopAllWatches } from "../watch";
import { handleRequest } from "./handlers";

const context = { clientKey: "test-client" };
let dataDir: string;
let repo: string;
let notes: string;
let nestedRepo: string;
let repositoryWithinRepository: string;
let mountRoot: string;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "gooseberry-handlers-"));
	mountRoot = mkdtempSync(join(tmpdir(), "gooseberry-handlers-mount-"));
	mountRoot = realpathSync(mountRoot);
	setMountedProjectRootsForTesting([mountRoot]);
	setDataDirForTests(dataDir);
	resetConfigCache();
	repo = join(mountRoot, "repo");
	notes = join(mountRoot, "notes");
	nestedRepo = join(notes, "nested-repo");
	repositoryWithinRepository = join(repo, "packages", "independent");
	mkdirSync(repo);
	mkdirSync(nestedRepo, { recursive: true });
	repo = realpathSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "test@gooseberry.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	mkdirSync(repositoryWithinRepository, { recursive: true });
	git(repositoryWithinRepository, "init", "-b", "main");
	git(repositoryWithinRepository, "config", "user.email", "test@gooseberry.test");
	git(repositoryWithinRepository, "config", "user.name", "test");
	writeFileSync(join(repositoryWithinRepository, "README.md"), "# independent\n");
	git(repositoryWithinRepository, "add", "-A");
	git(repositoryWithinRepository, "commit", "-m", "init");
	writeFileSync(join(notes, "notes.txt"), "not a repository\n");
	git(nestedRepo, "init", "-b", "main");
	git(nestedRepo, "config", "user.email", "test@gooseberry.test");
	git(nestedRepo, "config", "user.name", "test");
	writeFileSync(join(nestedRepo, "README.md"), "# nested\n");
	git(nestedRepo, "add", "-A");
	git(nestedRepo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "project", roots: [repo, notes], slug: "project", lastOpened: 1 },
		]),
	);
});

afterEach(() => {
	setMountedProjectRootsForTesting(undefined);
	stopAllWatches();
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(mountRoot, { recursive: true, force: true });
	setDataDirForTests(undefined);
	resetConfigCache();
});

test("directory projects expose discovered Git repositories without managing them", async () => {
	const projects = (await handleRequest("project.list", {}, context)) as { roots: string[] }[];
	expect(projects[0]?.roots).toEqual([repo, notes]);
	const repositories = (await handleRequest(
		"git.listRepositories",
		{ projectId: "p1" },
		context,
	)) as { root: string; head: { kind: string; name?: string } }[];
	expect(repositories).toHaveLength(3);
	expect(repositories).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ root: repo, head: { kind: "branch", name: "main" } }),
			expect.objectContaining({ root: nestedRepo, head: { kind: "branch", name: "main" } }),
			expect.objectContaining({
				root: repositoryWithinRepository,
				head: { kind: "branch", name: "main" },
			}),
		]),
	);
});

test("projects persist validated display names and icons without changing stable slugs", async () => {
	const updated = await handleRequest(
		"project.update",
		{ id: "p1", name: "  Research lab  ", icon: "flask" },
		context,
	);
	expect(updated).toMatchObject({ id: "p1", name: "Research lab", icon: "flask", slug: "project" });
	expect(await handleRequest("project.list", {}, context)).toEqual([
		expect.objectContaining({ id: "p1", name: "Research lab", icon: "flask", slug: "project" }),
	]);
	await expect(
		handleRequest("project.update", { id: "p1", icon: "arbitrary" }, context),
	).rejects.toThrow("Unknown project icon");
});

test("browser protocol does not allow users to mutate agent-owned tasks", async () => {
	await expect(
		handleRequest(
			"session.tasksSet",
			{ projectId: "p1", sessionId: "session", tasks: [] },
			context,
		),
	).rejects.toThrow("Unknown method");
});

test("settings expose model visibility and optional Signet configuration", async () => {
	const config = await handleRequest(
		"settings.update",
		{
			config: {
				signet: { enabled: true, address: "127.0.0.1", port: 3850 },
				hiddenModels: [{ provider: "alpha", id: "one" }],
			},
		},
		context,
	);
	expect(config).toMatchObject({ signet: { enabled: true, address: "127.0.0.1", port: 3850 } });
	expect(config).toMatchObject({ hiddenModels: [{ provider: "alpha", id: "one" }] });
	expect(JSON.stringify(config)).not.toContain("piProfile");
	expect(JSON.stringify(config)).not.toContain("modelPreferences");
});

test("prompt and steer reject malformed image payloads before session mutation", async () => {
	const request = (images: unknown, text: unknown = "describe") =>
		handleRequest("session.prompt", { sessionId: "missing", text, images }, context);
	await expect(request({})).rejects.toThrow("images must be an array");
	await expect(request([{ type: "image", mimeType: "image/bmp", data: "AA==" }])).rejects.toThrow(
		"Unsupported image media type",
	);
	await expect(
		request([{ type: "image", mimeType: "image/png", data: "not base64" }]),
	).rejects.toThrow("canonical base64");
	await expect(
		request([
			{ type: "image", mimeType: "image/png", data: "A".repeat(IMAGE_MAX_BASE64_BYTES + 4) },
		]),
	).rejects.toThrow("4.5 MiB");
	await expect(
		request(
			Array.from({ length: 6 }, () => ({
				type: "image",
				mimeType: "image/png",
				data: "A".repeat(IMAGE_MAX_BASE64_BYTES),
			})),
		),
	).rejects.toThrow("24 MiB");
	await expect(request([], 42)).rejects.toThrow("Malformed session request");

	// This is valid at the per-image boundary. The following unknown-session
	// error proves validation completed before the session lookup.
	await expect(
		request([{ type: "image", mimeType: "image/png", data: "A".repeat(IMAGE_MAX_BASE64_BYTES) }]),
	).rejects.toThrow("Unknown session: missing");
	await expect(
		handleRequest(
			"session.steer",
			{
				sessionId: "missing",
				text: "continue",
				images: [{ type: "image", mimeType: "image/png", data: "AA==" }],
			},
			context,
		),
	).rejects.toThrow("Unknown session: missing");
});

test("session lifecycle requests enforce project ownership and bounded titles before ACP", async () => {
	recordProjectSession({ projectId: "p1", sessionId: "session-1", cwd: repo });
	await expect(
		handleRequest(
			"session.rename",
			{ projectId: "p1", sessionId: "session-1", title: "   " },
			context,
		),
	).rejects.toThrow("Session title cannot be empty");
	await expect(
		handleRequest(
			"session.archive",
			{ projectId: "another-project", sessionId: "session-1" },
			context,
		),
	).rejects.toThrow("Unknown session: session-1");
	await expect(
		handleRequest("session.list", { projectId: "p1", archived: "yes" }, context),
	).rejects.toThrow("Malformed session list request");
	await expect(
		handleRequest(
			"session.fork",
			{ projectId: "another-project", sessionId: "session-1" },
			context,
		),
	).rejects.toThrow("Unknown session: session-1");
	await expect(
		handleRequest("session.fork", { projectId: "p1", sessionId: 1 }, context),
	).rejects.toThrow("Malformed session request");
});
