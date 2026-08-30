import { expect, test } from "bun:test";
import type { Project } from "@gooseberry/contracts";
import { useAppStore } from "../../store";
import type { NavigationDriver } from "./driver";
import { initNavigation } from "./init";

test("navigation cleanup cancels pending route application and permits a fresh subscription", async () => {
	useAppStore.setState(useAppStore.getInitialState(), true);
	const project: Project = {
		id: "p1",
		name: "Project",
		roots: ["/tmp/project"],
		slug: "project",
		lastOpened: 1,
	};
	useAppStore.getState().installWelcomeSnapshot(1, [project], [project]);
	const handlers = new Set<(fragment: string) => void>();
	const writes: string[] = [];
	const driver: NavigationDriver = {
		read: () => "#/v1/projects/p1/projectAreas/p1/chats/chat-a",
		replace: (fragment) => writes.push(fragment),
		push: (fragment) => writes.push(fragment),
		onIncoming: (handler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
	};

	const stopFirst = initNavigation(driver);
	expect(handlers.size).toBe(1);
	stopFirst();
	await Promise.resolve();
	expect(handlers.size).toBe(0);
	expect(useAppStore.getState().activeProjectAreaId).toBeNull();
	expect(useAppStore.getState().routeChatTarget).toBeNull();
	expect(useAppStore.getState().projectAreas).toEqual({});

	const stopSecond = initNavigation(driver);
	try {
		expect(handlers.size).toBe(1);
		await Promise.resolve();
		expect(useAppStore.getState().activeProjectAreaId).toBe("p1");
		expect(useAppStore.getState().routeChatTarget).toMatchObject({
			projectAreaId: "p1",
			sessionId: "chat-a",
		});
		stopSecond();
		const writesAfterCleanup = writes.length;
		useAppStore.getState().selectMain();
		expect(handlers.size).toBe(0);
		expect(writes).toHaveLength(writesAfterCleanup);
	} finally {
		stopSecond();
		useAppStore.setState(useAppStore.getInitialState(), true);
	}
});
