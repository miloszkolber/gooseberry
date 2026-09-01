import { afterEach, expect, spyOn, test } from "bun:test";
import { PROTOCOL_VERSION, type WsParams, type WsResult } from "@gooseberry/contracts";
import { initTransport, resetTransport } from "@/connection";
import { WsTransport } from "@/connection/transport";
import { projectArea, useAppStore } from "@/store";
import { hydrateChatResource } from "@/workspace/chat-reconciliation";
import { initSessionLeases } from "@/workspace/session-leases";

afterEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

test("leases derive from open tabs, restore after reconnect and stop with their subscription", async () => {
	useAppStore.setState(useAppStore.getInitialState(), true);
	const project = {
		id: "project",
		name: "Project",
		roots: ["/project"],
		slug: "project",
		lastOpened: 1,
	};
	useAppStore.getState().installWelcomeSnapshot(PROTOCOL_VERSION, [project], [project]);
	useAppStore.getState().setStatus("connected");
	useAppStore.setState({
		projectAreas: { project: [projectArea(project), { ...projectArea(project), id: "alias" }] },
	});
	const calls: WsParams<"session.setLeases">[] = [];
	const transport = {
		request: async (method: string, params: WsParams<"session.setLeases">) => {
			expect(method).toBe("session.setLeases");
			calls.push(params);
			return { ok: true };
		},
	} as Pick<WsTransport, "request">;
	const stop = initSessionLeases(transport);
	try {
		await Promise.resolve();
		expect(calls.at(-1)?.sessions).toEqual([]);
		const tab = {
			kind: "chat" as const,
			id: "chat-tab",
			projectAreaId: "project",
			sessionId: "chat",
			name: "Chat",
		};
		useAppStore.setState({
			tabsByProjectArea: { project: [tab], alias: [{ ...tab, projectAreaId: "alias" }] },
		});
		await Promise.resolve();
		expect(calls.at(-1)?.sessions).toEqual([{ projectId: "project", sessionId: "chat" }]);
		const before = calls.length;
		useAppStore.setState({ tabsByProjectArea: { alias: [{ ...tab, projectAreaId: "alias" }] } });
		useAppStore.setState({ toasts: [] });
		await Promise.resolve();
		expect(calls).toHaveLength(before);
		useAppStore.getState().setStatus("disconnected");
		await Promise.resolve();
		useAppStore.getState().setStatus("connected");
		await Promise.resolve();
		expect(calls).toHaveLength(before + 1);
		expect(calls.at(-1)?.revision).toBeGreaterThan(calls.at(-2)?.revision ?? 0);
		useAppStore.getState().applyProjectUpdated({ ...project, closed: true });
		await Promise.resolve();
		expect(calls.at(-1)?.sessions).toEqual([]);
		const completed = calls.length;
		useAppStore.getState().applyProjectUpdated(project);
		stop();
		await Promise.resolve();
		expect(calls).toHaveLength(completed);
	} finally {
		stop();
	}
});

test("an older failed snapshot cannot report an error for the current open tabs", async () => {
	useAppStore.setState(useAppStore.getInitialState(), true);
	useAppStore.getState().installWelcomeSnapshot(PROTOCOL_VERSION, [], []);
	useAppStore.getState().setStatus("connected");
	const failures: ((error: Error) => void)[] = [];
	const transport = {
		request: () => new Promise((_resolve, reject) => failures.push(reject)),
	} as Pick<WsTransport, "request">;
	const stop = initSessionLeases(transport);
	try {
		await Promise.resolve();
		useAppStore.getState().setStatus("disconnected");
		await Promise.resolve();
		useAppStore.getState().setStatus("connected");
		await Promise.resolve();
		failures[0]?.(new Error("old connection failed"));
		await Promise.resolve();
		expect(useAppStore.getState().toasts).toHaveLength(0);
		failures[1]?.(new Error("current snapshot failed"));
		await Promise.resolve();
		expect(useAppStore.getState().toasts.at(-1)?.message).toBe("current snapshot failed");
	} finally {
		stop();
	}
});

test("late hydration respects chat and project closure while allowing an explicit reopen", async () => {
	const location = Object.getOwnPropertyDescriptor(globalThis, "location");
	Object.defineProperty(globalThis, "location", {
		value: new URL("http://localhost:7312"),
		configurable: true,
	});
	const connect = spyOn(WsTransport.prototype, "connect").mockImplementation(() => {});
	const transport = initTransport();
	const replies: ((reply: WsResult<"session.getMessages">) => void)[] = [];
	const request = spyOn(transport, "request").mockImplementation(
		() => new Promise((resolve) => replies.push(resolve)),
	);
	const project = {
		id: "project",
		name: "Project",
		roots: ["/project"],
		slug: "project",
		lastOpened: 1,
	};
	useAppStore.getState().installWelcomeSnapshot(PROTOCOL_VERSION, [project], [project]);
	useAppStore.getState().setStatus("connected");
	useAppStore
		.getState()
		.openTab(
			{ kind: "chat", id: "chat-tab", projectAreaId: "project", sessionId: "chat", name: "Chat" },
			"keep",
		);
	const reply: WsResult<"session.getMessages"> = {
		summary: {
			sessionId: "chat",
			projectId: "project",
			cwd: "/project",
			title: "Chat",
			model: null,
			thinkingLevel: "off",
			isStreaming: false,
			messageCount: 0,
			updatedAt: 1,
			live: true,
			archived: false,
		},
		messages: [],
		pendingTools: [],
	};
	try {
		const previous = hydrateChatResource("project", "chat");
		useAppStore.getState().closeChatToHistory("chat", "project");
		const reopened = hydrateChatResource("project", "chat");
		expect(reopened).not.toBe(previous);
		expect(replies).toHaveLength(2);
		replies[0]?.(reply);
		expect(await previous).toBe(false);
		expect(useAppStore.getState().tabsByProjectArea.project).toEqual([]);
		expect(hydrateChatResource("project", "chat")).toBe(reopened);
		replies[1]?.(reply);
		expect(await reopened).toBe(true);
		expect(useAppStore.getState().tabsByProjectArea.project).toHaveLength(1);
		const runtime = useAppStore.getState().sessions.chat;
		if (!runtime) throw new Error("chat runtime missing");
		useAppStore.setState({ sessions: { chat: { ...runtime, isStreaming: true } } });
		useAppStore.getState().closeChatToHistory("chat", "project");
		expect(await hydrateChatResource("project", "chat")).toBe(true);
		expect(replies).toHaveLength(2);
		expect(useAppStore.getState().tabsByProjectArea.project).toHaveLength(1);

		useAppStore.getState().closeChatRuntime("chat");
		const closingProject = hydrateChatResource("project", "chat");
		useAppStore.getState().applyProjectUpdated({ ...project, closed: true });
		replies[2]?.(reply);
		expect(await closingProject).toBe(false);
		expect(useAppStore.getState().sessions.chat).toBeUndefined();
	} finally {
		request.mockRestore();
		resetTransport();
		connect.mockRestore();
		if (location) Object.defineProperty(globalThis, "location", location);
		else Reflect.deleteProperty(globalThis, "location");
	}
});
