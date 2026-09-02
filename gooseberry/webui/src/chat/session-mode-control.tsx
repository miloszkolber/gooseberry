import type { SessionModeState } from "@gooseberry/contracts";
import { useEffect, useId, useState } from "react";
import { errorText, getTransport } from "../connection";
import { toast } from "../store";

export function SessionModeControl({
	sessionId,
	modes,
}: {
	sessionId: string;
	modes: SessionModeState | null;
}) {
	const [requestedModeId, setRequestedModeId] = useState<string | null>(null);
	const descriptionId = useId();

	useEffect(() => {
		if (requestedModeId === modes?.currentModeId) setRequestedModeId(null);
	}, [modes?.currentModeId, requestedModeId]);

	if (!modes || modes.availableModes.length === 0) return null;
	const currentMode = modes.availableModes.find((mode) => mode.id === modes.currentModeId);

	return (
		<>
			<select
				data-testid="session-mode-trigger"
				aria-label="Session mode"
				aria-describedby={currentMode?.description ? descriptionId : undefined}
				aria-busy={requestedModeId !== null}
				title={currentMode?.description ?? "Change the agent mode for this session"}
				value={modes.currentModeId}
				disabled={requestedModeId !== null}
				onChange={(event) => {
					const modeId = event.target.value;
					if (modeId === modes.currentModeId) return;
					setRequestedModeId(modeId);
					void getTransport()
						.request("session.setMode", { sessionId, modeId })
						.catch((error: unknown) => {
							setRequestedModeId(null);
							toast.error(errorText(error), "Couldn't change the session mode");
						});
				}}
				className="min-w-0 max-w-32 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-xs py-0.5 text-text-default tr-text-metadata outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:text-text-muted"
			>
				{modes.availableModes.map((mode) => (
					<option key={mode.id} value={mode.id} title={mode.description}>
						{mode.name}
					</option>
				))}
			</select>
			{currentMode?.description ? (
				<span id={descriptionId} className="sr-only">
					{currentMode.description}
				</span>
			) : null}
		</>
	);
}
