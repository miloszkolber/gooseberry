import { type FSWatcher, watch } from "node:fs";
import { basename, join } from "node:path";
import type { ProjectFsChangedPayload, ProjectWatchReadyResult } from "@mewa-code/contracts";
import { getProject } from "../projects";

type Publisher = (payload: ProjectFsChangedPayload) => void;

interface ActiveWatch {
	watchers: FSWatcher[];
	paths: Set<string>;
	timer: ReturnType<typeof setTimeout> | undefined;
}

const active = new Map<string, ActiveWatch>();
let publish: Publisher = () => {};

export function setWatchPublisher(next: Publisher): void {
	publish = next;
}

function flush(projectId: string, state: ActiveWatch): void {
	state.timer = undefined;
	const paths = [...state.paths].sort().slice(0, 500);
	const truncated = state.paths.size > paths.length;
	state.paths.clear();
	if (paths.length > 0) publish({ projectId, paths, truncated });
}

function note(projectId: string, state: ActiveWatch, path: string): void {
	state.paths.add(path);
	if (state.timer) return;
	state.timer = setTimeout(() => flush(projectId, state), 100);
}

export function ensureWatch(
	projectId: string,
	_options: { prewarm?: boolean } = {},
): ProjectWatchReadyResult {
	if (active.has(projectId)) return { startupNudge: false };
	const project = getProject(projectId);
	const state: ActiveWatch = { watchers: [], paths: new Set(), timer: undefined };
	try {
		for (const root of project.roots) {
			state.watchers.push(
				watch(root, { recursive: true }, (_event, filename) => {
					if (!filename) return;
					note(projectId, state, join(basename(root), filename.toString()));
				}),
			);
		}
		active.set(projectId, state);
		return { startupNudge: true };
	} catch (error) {
		for (const watcher of state.watchers) watcher.close();
		throw error;
	}
}

export function stopWatch(projectId: string): void {
	const state = active.get(projectId);
	if (!state) return;
	if (state.timer) clearTimeout(state.timer);
	for (const watcher of state.watchers) watcher.close();
	active.delete(projectId);
}

export function stopAllWatches(): void {
	for (const projectId of active.keys()) stopWatch(projectId);
}
