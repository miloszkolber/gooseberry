import type { ProjectFsChange } from "@gooseberry/contracts";
import { useEffect, useRef } from "react";
import { useAppStore } from "../store";

type LiveTab = {
	projectAreaId: string;
	path: string;
	root?: string;
	repository?: string;
	loadedTick?: number;
};

function normalizedResource(root: string, path: string): string {
	return `${root.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function changeNamesPath(change: ProjectFsChange, root: string | undefined, path: string): boolean {
	return (
		root !== undefined &&
		normalizedResource(change.root, change.path) === normalizedResource(root, path)
	);
}

export function changeNamesResource(change: ProjectFsChange, tab: LiveTab): boolean {
	return changeNamesPath(change, tab.root ?? tab.repository, tab.path);
}

export function useLiveTabContent<T>(
	tab: LiveTab,
	ops: {
		read: () => Promise<T>;
		applyFresh: (fresh: T, tick: number) => void;
		keepCurrent: (tick: number) => void;
	},
	reloadKey?: string,
	loadedKey?: string,
) {
	const change = useAppStore((s) => s.fsChangesByProjectArea[tab.projectAreaId]);
	const opsRef = useRef(ops);
	opsRef.current = ops;
	const sequencerRef = useRef<ReadSequencer | null>(null);
	sequencerRef.current ??= createReadSequencer();
	const sequencer = sequencerRef.current;
	const resourceRoot = tab.root ?? tab.repository;

	useEffect(() => {
		if (!change) return;
		const loaded = tab.loadedTick ?? 0;
		if (change.tick <= loaded) return;
		const { read, applyFresh, keepCurrent } = opsRef.current;
		const namesOtherFiles =
			change.changes.length > 0 &&
			!change.changes.some((item) => changeNamesPath(item, resourceRoot, tab.path));
		if (change.tick === loaded + 1 && !change.truncated && namesOtherFiles) {
			keepCurrent(change.tick);
			return;
		}
		let cancelled = false;
		const isCurrent = sequencer.begin();
		read()
			.then((fresh) => {
				if (!cancelled && isCurrent()) applyFresh(fresh, change.tick);
			})
			.catch(() => {
				if (!cancelled && isCurrent()) keepCurrent(change.tick);
			});
		return () => {
			cancelled = true;
		};
	}, [change, tab.path, tab.loadedTick, resourceRoot, sequencer]);

	const lastKey = useRef(loadedKey ?? reloadKey);
	useEffect(() => {
		if (reloadKey === undefined) return;
		if (reloadKey === loadedKey) {
			lastKey.current = reloadKey;
			return;
		}
		if (reloadKey === lastKey.current) return;
		lastKey.current = reloadKey;
		const { read, applyFresh } = opsRef.current;
		let cancelled = false;
		const isCurrent = sequencer.begin();
		read()
			.then((fresh) => {
				if (!cancelled && isCurrent()) applyFresh(fresh, tab.loadedTick ?? 0);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [reloadKey, loadedKey, tab.loadedTick, sequencer]);
}

export type ReadSequencer = { begin: () => () => boolean };

export function createReadSequencer(): ReadSequencer {
	let latest = 0;
	return {
		begin: () => {
			const seq = ++latest;
			return () => seq === latest;
		},
	};
}
