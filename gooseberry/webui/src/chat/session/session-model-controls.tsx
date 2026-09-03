import type { ProviderStatus, ThinkingLevel, WireModel } from "@gooseberry/contracts";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { errorText, getTransport } from "../../connection";
import { toast, useAppStore } from "../../store";

function modelKey(model: Pick<WireModel, "provider" | "id">): string {
	return `${model.provider}\u0000${model.id}`;
}

export function sessionSelectableModels(
	models: readonly WireModel[],
	providers: readonly ProviderStatus[],
): WireModel[] {
	const availableProviders = new Set(
		providers
			.filter((provider) => provider.configured && provider.available !== false)
			.map((provider) => provider.id),
	);
	return models.filter(
		(model) => availableProviders.has(model.provider) && model.available && !model.hidden,
	);
}

export function thinkingLevelsForCurrent(
	level: ThinkingLevel,
	reported: readonly ThinkingLevel[],
): ThinkingLevel[] {
	return reported.includes(level) ? [...reported] : [level, ...reported];
}

export function firstModelForProvider(
	models: readonly WireModel[],
	providerId: string,
): WireModel | null {
	return models.find((model) => model.provider === providerId) ?? null;
}

export function SessionModelControls({
	sessionId,
	model,
	thinkingLevel,
	isStreaming,
}: {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
}) {
	const [catalog, setCatalog] = useState<WireModel[]>([]);
	const [providers, setProviders] = useState<ProviderStatus[]>([]);
	const [reportedThinkingLevels, setReportedThinkingLevels] = useState<ThinkingLevel[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<"model" | "thinking" | null>(null);
	const loadSequence = useRef(0);
	const providerVersion = useAppStore((state) => state.providerVersion);
	const providerLabelId = useId();
	const modelLabelId = useId();
	const thinkingLabelId = useId();

	useEffect(() => {
		void providerVersion;
		const sequence = ++loadSequence.current;
		setLoading(true);
		void Promise.all([
			getTransport().request("model.list", {}),
			getTransport().request("provider.status", {}),
			getTransport().request("model.thinkingLevels", { sessionId }),
		])
			.then(([nextModels, report, thinking]) => {
				if (sequence !== loadSequence.current) return;
				setCatalog(nextModels);
				setProviders(report.providers);
				setReportedThinkingLevels(thinking.levels);
			})
			.catch((error) => {
				if (sequence !== loadSequence.current) return;
				setCatalog([]);
				setProviders([]);
				setReportedThinkingLevels([]);
				toast.error(errorText(error), "Couldn't load session model controls");
			})
			.finally(() => {
				if (sequence === loadSequence.current) setLoading(false);
			});
	}, [providerVersion, sessionId]);

	const models = useMemo(() => sessionSelectableModels(catalog, providers), [catalog, providers]);
	const providerIds = useMemo(
		() => [...new Set(models.map((candidate) => candidate.provider))],
		[models],
	);
	const providerNames = useMemo(
		() => new Map(providers.map((provider) => [provider.id, provider.name])),
		[providers],
	);
	const selectedModel = model ?? null;
	const currentModelSelectable = selectedModel
		? models.some((candidate) => modelKey(candidate) === modelKey(selectedModel))
		: false;
	const currentProviderSelectable = selectedModel
		? providerIds.includes(selectedModel.provider)
		: false;
	const selectedProvider = selectedModel?.provider ?? "";
	const thinkingLevels = thinkingLevelsForCurrent(thinkingLevel, reportedThinkingLevels);
	const modelControlsDisabled = loading || isStreaming || busy !== null || models.length === 0;
	const thinkingDisabled = isStreaming || busy !== null;

	const changeModel = useCallback(
		async (nextModel: WireModel) => {
			if (model && modelKey(nextModel) === modelKey(model)) return;
			setBusy("model");
			try {
				try {
					await getTransport().request("session.setModel", { sessionId, model: nextModel });
					useAppStore.getState().setCurrentModel(sessionId, nextModel);
				} catch (error) {
					toast.error(errorText(error), "Couldn't change the session model");
					return;
				}
				try {
					const thinking = await getTransport().request("model.thinkingLevels", { sessionId });
					setReportedThinkingLevels(thinking.levels);
					const { level } = await getTransport().request("model.clampThinking", {
						sessionId,
						level: thinkingLevel,
					});
					if (level === thinkingLevel) return;
					await getTransport().request("session.setThinkingLevel", { sessionId, level });
					useAppStore.getState().setThinkingLevel(sessionId, level);
				} catch (error) {
					toast.error(errorText(error), "Couldn't update thinking after changing the model");
				}
			} finally {
				setBusy(null);
			}
		},
		[model, sessionId, thinkingLevel],
	);

	const changeThinking = useCallback(
		async (level: ThinkingLevel) => {
			if (level === thinkingLevel) return;
			setBusy("thinking");
			try {
				const clamped = await getTransport().request("model.clampThinking", { sessionId, level });
				if (clamped.level === thinkingLevel) return;
				await getTransport().request("session.setThinkingLevel", {
					sessionId,
					level: clamped.level,
				});
				useAppStore.getState().setThinkingLevel(sessionId, clamped.level);
			} catch (error) {
				toast.error(errorText(error), "Couldn't change the thinking level");
			} finally {
				setBusy(null);
			}
		},
		[sessionId, thinkingLevel],
	);

	return (
		<div
			data-testid="session-model-controls"
			aria-busy={loading || busy !== null}
			className="flex min-w-0 flex-wrap items-center gap-xs"
		>
			<label className="flex min-w-0 items-center gap-2xs">
				<span id={providerLabelId} className="sr-only">
					Provider
				</span>
				<select
					data-testid="session-provider-select"
					aria-labelledby={providerLabelId}
					value={selectedProvider}
					disabled={modelControlsDisabled}
					onChange={(event) => {
						const next = firstModelForProvider(models, event.target.value);
						if (next) void changeModel(next);
					}}
					className="min-w-0 max-w-28 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-xs py-0.5 text-text-default tr-text-metadata outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:text-text-muted"
				>
					{selectedModel && !currentProviderSelectable ? (
						<option value={selectedModel.provider} disabled>
							{providerNames.get(selectedModel.provider) ?? selectedModel.provider} (current)
						</option>
					) : null}
					<option value="" disabled>
						{loading ? "Loading providers…" : "No providers"}
					</option>
					{providerIds.map((providerId) => (
						<option key={providerId} value={providerId}>
							{providerNames.get(providerId) ?? providerId}
						</option>
					))}
				</select>
			</label>
			<label className="flex min-w-0 items-center gap-2xs">
				<span id={modelLabelId} className="sr-only">
					Model
				</span>
				<select
					data-testid="session-model-select"
					aria-labelledby={modelLabelId}
					value={selectedModel ? modelKey(selectedModel) : ""}
					disabled={modelControlsDisabled}
					onChange={(event) => {
						const next = models.find((candidate) => modelKey(candidate) === event.target.value);
						if (next) void changeModel(next);
					}}
					className="min-w-0 max-w-44 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-xs py-0.5 text-text-default tr-text-metadata outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:text-text-muted"
				>
					{selectedModel && !currentModelSelectable ? (
						<option value={modelKey(selectedModel)} disabled>
							{selectedModel.name || selectedModel.id} (current)
						</option>
					) : null}
					<option value="" disabled>
						{loading ? "Loading models…" : "No available models"}
					</option>
					{models.map((candidate) => (
						<option key={modelKey(candidate)} value={modelKey(candidate)}>
							{candidate.name || candidate.id}
						</option>
					))}
				</select>
			</label>
			<label className="flex min-w-0 items-center gap-2xs">
				<span id={thinkingLabelId} className="sr-only">
					Thinking
				</span>
				<select
					data-testid="session-thinking-select"
					aria-labelledby={thinkingLabelId}
					value={thinkingLevel}
					disabled={thinkingDisabled}
					onChange={(event) => void changeThinking(event.target.value)}
					className="min-w-0 max-w-24 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-xs py-0.5 text-text-default tr-text-metadata outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:text-text-muted"
				>
					{thinkingLevels.map((level) => (
						<option key={level} value={level}>
							{level}
						</option>
					))}
				</select>
			</label>
		</div>
	);
}
