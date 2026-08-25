import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import {
	createSession,
	disposeAllSessions,
	ensureSessionAttached,
	getSessionMessages,
	getSessionRuntimeGenerationId,
	listSessions,
	promptSession,
	removeSession,
	runChildSession,
	setSessionManagerFactory,
	setSessionPublisher,
	toWireModel,
} from "./agent-session-manager";
import { configurePiRuntime } from "./pi-runtime";

function modelDef(id: string) {
	return {
		id,
		name: id,
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 4096,
	};
}

const fauxA = createFauxCore({
	provider: "fauxa",
	api: "fauxa",
	models: [modelDef("fauxa")],
	tokensPerSecond: 20_000,
});
const fauxB = createFauxCore({
	provider: "fauxb",
	api: "fauxb",
	models: [modelDef("fauxb")],
	tokensPerSecond: 20_000,
});

const cfg = (faux: typeof fauxA, id: string) => ({
	api: faux.api,
	baseUrl: "http://faux.local",
	apiKey: "faux",
	streamSimple: faux.streamSimple,
	models: [{ ...modelDef(id), api: faux.api }],
});

const events = new Map<string, unknown[]>();
const tmpDirs: string[] = [];

function tmpCwd(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	tmpDirs.push(directory);
	return directory;
}

let previousAgentDir: string | undefined;
let previousOffline: string | undefined;
let runtime: ModelRuntime;

beforeAll(async () => {
	previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = tmpCwd("mewa-code-agent-");
	previousOffline = process.env.PI_OFFLINE;
	process.env.PI_OFFLINE = "1";

	runtime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	runtime.registerProvider("fauxa", cfg(fauxA, "fauxa"));
	runtime.registerProvider("fauxb", cfg(fauxB, "fauxb"));
	configurePiRuntime(runtime);
	setSessionManagerFactory(() => SessionManager.inMemory());
	setSessionPublisher(({ sessionId, event }) => {
		const sessionEvents = events.get(sessionId) ?? [];
		sessionEvents.push(event);
		events.set(sessionId, sessionEvents);
	});
});

afterAll(() => {
	disposeAllSessions();
	setSessionPublisher(() => {});
	setSessionManagerFactory(() => SessionManager.inMemory());
	configurePiRuntime(null);
	for (const directory of tmpDirs) rmSync(directory, { recursive: true, force: true });
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	if (previousOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = previousOffline;
});

test("concurrent sessions keep streamed responses and disposal isolated", async () => {
	fauxA.setResponses([fauxAssistantMessage("ALPHA_REPLY")]);
	fauxB.setResponses([fauxAssistantMessage("BRAVO_REPLY")]);

	const first = await createSession({
		cwd: tmpCwd("mewa-code-session-a-"),
		workspaceId: "workspace-a",
		model: toWireModel(fauxA.getModel()),
	});
	const second = await createSession({
		cwd: tmpCwd("mewa-code-session-b-"),
		workspaceId: "workspace-b",
		model: toWireModel(fauxB.getModel()),
	});

	await Promise.all([
		promptSession(first.sessionId, "hello A"),
		promptSession(second.sessionId, "hello B"),
	]);

	const firstEvents = JSON.stringify(events.get(first.sessionId) ?? []);
	const secondEvents = JSON.stringify(events.get(second.sessionId) ?? []);
	const firstEventCount = (events.get(first.sessionId) ?? []).length;
	expect(first.sessionId).not.toBe(second.sessionId);
	expect(firstEvents).toContain("ALPHA_REPLY");
	expect(firstEvents).not.toContain("BRAVO_REPLY");
	expect(secondEvents).toContain("BRAVO_REPLY");
	expect(secondEvents).not.toContain("ALPHA_REPLY");

	const secondEventCount = (events.get(second.sessionId) ?? []).length;
	removeSession(first.sessionId);
	fauxB.appendResponses([fauxAssistantMessage("BRAVO_AGAIN")]);
	await promptSession(second.sessionId, "again B");
	expect(JSON.stringify(events.get(second.sessionId) ?? [])).toContain("BRAVO_AGAIN");
	expect(events.get(first.sessionId)).toHaveLength(firstEventCount);
	expect(events.get(second.sessionId)?.length).toBeGreaterThan(secondEventCount);
	removeSession(second.sessionId);
});

test("a disposed session is listed from disk and restored with its transcript", async () => {
	setSessionManagerFactory((cwd) => SessionManager.create(cwd));
	const cwd = tmpCwd("mewa-code-session-disk-");
	fauxA.setResponses([fauxAssistantMessage("DISK_REPLY")]);

	try {
		const session = await createSession({
			cwd,
			workspaceId: "workspace-disk",
			model: toWireModel(fauxA.getModel()),
		});
		await promptSession(session.sessionId, "persist me");
		removeSession(session.sessionId);

		const listed = await listSessions("workspace-disk", cwd);

		expect(listed).toContainEqual(
			expect.objectContaining({ sessionId: session.sessionId, live: false }),
		);
		expect(await ensureSessionAttached(session.sessionId, "workspace-disk", cwd)).toBe(true);
		const restored = await getSessionMessages(session.sessionId, "workspace-disk", cwd);
		expect(restored.summary.live).toBe(true);
		expect(restored.messages.some((message) => message.role === "user")).toBe(true);
		expect(restored.messages.some((message) => message.role === "assistant")).toBe(true);
		removeSession(session.sessionId);
	} finally {
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("runs a persistent child in the parent generation and admitted workspace", async () => {
	const cwd = tmpCwd("mewa-code-child-");
	const previousMountRoots = process.env.MEWA_MOUNT_ROOTS;
	process.env.MEWA_MOUNT_ROOTS = cwd;
	setSessionManagerFactory((path, options) => SessionManager.create(path, undefined, options));
	fauxA.setResponses([fauxAssistantMessage("CHILD_REPLY")]);

	try {
		const parent = await createSession({
			cwd,
			workspaceId: "workspace-child",
			model: toWireModel(fauxA.getModel()),
			thinkingLevel: "off",
		});
		const generation = getSessionRuntimeGenerationId(parent.sessionId);
		const progress: string[] = [];
		const child = await runChildSession(
			{
				parentSessionId: parent.sessionId,
				toolCallId: "tool-child",
				task: "Return the child reply.",
			},
			undefined,
			(snapshot) => progress.push(snapshot.status),
		);

		expect(child.status).toBe("completed");
		expect(child.finalOutput).toBe("CHILD_REPLY");
		expect(child.model?.provider).toBe("fauxa");
		expect(child.thinkingLevel).toBe("off");
		expect(child.parentSessionId).toBe(parent.sessionId);
		expect(progress).toContain("starting");
		expect(progress).toContain("completed");
		expect(getSessionRuntimeGenerationId(child.childSessionId)).toBe(generation);
		expect(
			(await listSessions("workspace-child", cwd)).find(
				(s) => s.sessionId === child.childSessionId,
			),
		).toMatchObject({ live: true, workspaceId: "workspace-child" });
		const infos = await SessionManager.list(cwd);
		const childInfo = infos.find((info) => info.id === child.childSessionId);
		expect(childInfo?.parentSessionPath).toContain(`${parent.sessionId}.jsonl`);

		await removeSession(child.childSessionId);
		await removeSession(parent.sessionId);
	} finally {
		if (previousMountRoots === undefined) delete process.env.MEWA_MOUNT_ROOTS;
		else process.env.MEWA_MOUNT_ROOTS = previousMountRoots;
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("allows a child model override from the parent runtime generation", async () => {
	const cwd = tmpCwd("mewa-code-child-model-");
	const previousMountRoots = process.env.MEWA_MOUNT_ROOTS;
	process.env.MEWA_MOUNT_ROOTS = cwd;
	setSessionManagerFactory((path, options) => SessionManager.create(path, undefined, options));
	fauxB.setResponses([fauxAssistantMessage("MODEL_B_REPLY")]);
	try {
		const parent = await createSession({
			cwd,
			workspaceId: "workspace-model",
			model: toWireModel(fauxA.getModel()),
		});
		const child = await runChildSession(
			{
				parentSessionId: parent.sessionId,
				toolCallId: "tool-model",
				task: "Use the requested child model.",
				model: { provider: "fauxb", id: "fauxb" },
			},
			undefined,
		);
		expect(child.status).toBe("completed");
		expect(child.model?.provider).toBe("fauxb");
		expect(child.finalOutput).toBe("MODEL_B_REPLY");
		await removeSession(child.childSessionId);
		await removeSession(parent.sessionId);
	} finally {
		if (previousMountRoots === undefined) delete process.env.MEWA_MOUNT_ROOTS;
		else process.env.MEWA_MOUNT_ROOTS = previousMountRoots;
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("rejects a child when the inherited workspace is no longer mounted", async () => {
	const cwd = tmpCwd("mewa-code-child-unmounted-");
	const previousMountRoots = process.env.MEWA_MOUNT_ROOTS;
	process.env.MEWA_MOUNT_ROOTS = tmpCwd("mewa-code-child-approved-");
	try {
		const parent = await createSession({
			cwd,
			workspaceId: "workspace-unmounted",
			model: toWireModel(fauxA.getModel()),
		});
		await expect(
			runChildSession(
				{
					parentSessionId: parent.sessionId,
					toolCallId: "tool-unmounted",
					task: "This must not launch.",
				},
				undefined,
			),
		).rejects.toThrow("outside the approved same-path mounts");
		await removeSession(parent.sessionId);
	} finally {
		if (previousMountRoots === undefined) delete process.env.MEWA_MOUNT_ROOTS;
		else process.env.MEWA_MOUNT_ROOTS = previousMountRoots;
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});

test("bounds child output by UTF-8 bytes", async () => {
	const cwd = tmpCwd("mewa-code-child-output-");
	const previousMountRoots = process.env.MEWA_MOUNT_ROOTS;
	process.env.MEWA_MOUNT_ROOTS = cwd;
	setSessionManagerFactory((path, options) => SessionManager.create(path, undefined, options));
	fauxA.setResponses([fauxAssistantMessage("😀".repeat(20_000))]);
	try {
		const parent = await createSession({
			cwd,
			workspaceId: "workspace-output",
			model: toWireModel(fauxA.getModel()),
		});
		const child = await runChildSession(
			{
				parentSessionId: parent.sessionId,
				toolCallId: "tool-output",
				task: "Return the large response.",
			},
			undefined,
		);
		expect(child.status).toBe("completed");
		expect(child.truncated).toBe(true);
		expect(child.finalOutput).toContain("[truncated]");
		expect(Buffer.byteLength(child.finalOutput ?? "", "utf8")).toBeLessThanOrEqual(32 * 1024);
		await removeSession(child.childSessionId);
		await removeSession(parent.sessionId);
	} finally {
		if (previousMountRoots === undefined) delete process.env.MEWA_MOUNT_ROOTS;
		else process.env.MEWA_MOUNT_ROOTS = previousMountRoots;
		setSessionManagerFactory(() => SessionManager.inMemory());
	}
});
