import { projectArea, useAppStore } from "../store";
import { browserNavigationDriver, type NavigationDriver } from "./driver";
import { startNavigation } from "./restore";

let started = false;

export function initNavigation(driver: NavigationDriver = browserNavigationDriver()): void {
	if (started) return;
	started = true;
	startNavigation({
		driver,
		listProjectAreas: async (projectId) => {
			const project = useAppStore
				.getState()
				.projects.find((candidate) => candidate.id === projectId);
			return project ? [projectArea(project)] : [];
		},
	});
}
