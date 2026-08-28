import { useCallback, useEffect, useRef } from "react";
import { selectProjectAreaTick, useAppStore } from "../store";

interface ProjectAreaReadHandlers<T> {
	onResult: (value: T, projectAreaId: string) => void;
	onFailure?: (projectAreaId: string, error: unknown) => void;
	onSwitch?: (projectAreaId: string) => void;
}

export function useProjectRead<T>(
	projectAreaId: string | null,
	read: (projectAreaId: string, readKey: string | undefined) => Promise<T>,
	handlers: ProjectAreaReadHandlers<T>,
	readKey?: string,
): { reload: () => void } {
	const latest = useRef({ read, handlers, projectAreaId, readKey });
	latest.current = { read, handlers, projectAreaId, readKey };
	const generation = useRef(0);

	const runRead = useCallback((id: string, key: string | undefined) => {
		if (useAppStore.getState().removedProjectAreaIds[id]) return;
		const mine = ++generation.current;
		const live = () =>
			generation.current === mine &&
			latest.current.projectAreaId === id &&
			latest.current.readKey === key &&
			!useAppStore.getState().removedProjectAreaIds[id];
		latest.current
			.read(id, key)
			.then((value) => {
				if (live()) latest.current.handlers.onResult(value, id);
			})
			.catch((error: unknown) => {
				if (live()) latest.current.handlers.onFailure?.(id, error);
			});
	}, []);

	useEffect(() => {
		if (!projectAreaId) return;
		runRead(projectAreaId, readKey);
		let tick = selectProjectAreaTick(useAppStore.getState(), projectAreaId);
		const unsubscribe = useAppStore.subscribe((state) => {
			const next = selectProjectAreaTick(state, projectAreaId);
			if (next === tick) return;
			tick = next;
			runRead(projectAreaId, readKey);
		});
		return () => {
			unsubscribe();
			generation.current += 1;
			latest.current.handlers.onSwitch?.(projectAreaId);
		};
	}, [projectAreaId, readKey, runRead]);

	return {
		reload: () => {
			if (projectAreaId) runRead(projectAreaId, readKey);
		},
	};
}
