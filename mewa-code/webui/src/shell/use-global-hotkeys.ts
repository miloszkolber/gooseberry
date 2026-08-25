import { useEffect, useRef } from "react";
import { hasPlatformModifier } from "../lib";
import { selectHistoryTarget, useAppStore } from "../store";

type GlobalHotkeyActions = {
	onProjects: () => void;
	onProjectArea?: () => void;
};

export function useGlobalHotkeys(actions: GlobalHotkeyActions): void {
	const actionsRef = useRef(actions);
	actionsRef.current = actions;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const isPanelCommand =
				!event.altKey &&
				!event.shiftKey &&
				hasPlatformModifier(event) &&
				(event.code === "KeyB" || event.code === "KeyJ");
			if (isPanelCommand) {
				event.preventDefault();
				event.stopPropagation();
				if (!event.repeat) {
					if (event.code === "KeyB") actionsRef.current.onProjects();
					else actionsRef.current.onProjectArea?.();
				}
				return;
			}

			if (
				event.code !== "KeyR" ||
				!event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				event.shiftKey
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			const target = selectHistoryTarget(useAppStore.getState());
			if (target) useAppStore.getState().requestHistoryOpen(target);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
