import type {
	ProviderStatus,
	ProviderStatusReport,
	WireModel,
	WireModelCostRates,
	WireModelCostTier,
} from "@gooseberry/contracts";
import { BrainCircuit, Eye, EyeOff, Image, RefreshCw, Search, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

export function formatTokenCount(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "—";
	if (value >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${millions >= 10 || Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}M`;
	}
	if (value >= 1_000) {
		const thousands = value / 1_000;
		return `${thousands >= 10 || Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}K`;
	}
	return String(value);
}

export function formatModelPrice(value: number): string {
	if (!Number.isFinite(value) || value < 0) return "—";
	if (value === 0) return "$0";
	if (value < 0.01) return `$${value.toFixed(4)}`;
	if (value < 1) return `$${value.toFixed(2)}`;
	return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function rateText(rates: WireModelCostRates): string {
	return `In ${formatModelPrice(rates.input)} · Out ${formatModelPrice(rates.output)}`;
}

function cacheText(rates: WireModelCostRates): string | null {
	if (rates.cacheRead === 0 && rates.cacheWrite === 0) return null;
	return `Cache read ${formatModelPrice(rates.cacheRead)} · write ${formatModelPrice(rates.cacheWrite)}`;
}

function tierText(tier: WireModelCostTier): string {
	return `Over ${formatTokenCount(tier.inputTokensAbove)} input: ${rateText(tier)}`;
}

function providerName(provider: string, providers: ReadonlyMap<string, ProviderStatus>): string {
	return providers.get(provider)?.name ?? provider;
}

export function filterModels(
	models: readonly WireModel[],
	providers: ReadonlyMap<string, ProviderStatus>,
	query: string,
): WireModel[] {
	const normalized = query.trim().toLocaleLowerCase();
	if (!normalized) return [...models];
	return models.filter((model) =>
		[model.name, model.id, model.provider, providerName(model.provider, providers)]
			.join("\n")
			.toLocaleLowerCase()
			.includes(normalized),
	);
}

export function ModelsSettings() {
	const [models, setModels] = useState<WireModel[]>([]);
	const [report, setReport] = useState<ProviderStatusReport>({ providers: [] });
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [failed, setFailed] = useState(false);
	const [busyModel, setBusyModel] = useState<string | null>(null);
	const [bulkBusy, setBulkBusy] = useState(false);
	const providerVersion = useAppStore((state) => state.providerVersion);
	const loadSequence = useRef(0);

	const load = useCallback(async (force = false) => {
		const sequence = ++loadSequence.current;
		setRefreshing(true);
		try {
			const [catalog, providers] = await Promise.all([
				force
					? getTransport().request("model.refresh", { force: true })
					: getTransport().request("model.list", {}),
				getTransport().request("provider.status", {}),
			]);
			if (sequence !== loadSequence.current) return;
			setModels(Array.isArray(catalog) ? catalog : catalog.models);
			setReport(providers);
			setFailed(false);
		} catch (error) {
			if (sequence !== loadSequence.current) return;
			setFailed(true);
			if (force) toast.error(errorText(error), "Couldn't refresh models");
		} finally {
			if (sequence === loadSequence.current) {
				setLoading(false);
				setRefreshing(false);
			}
		}
	}, []);

	useEffect(() => {
		void providerVersion;
		void load(false);
	}, [load, providerVersion]);

	const providers = useMemo(
		() => new Map(report.providers.map((provider) => [provider.id, provider])),
		[report.providers],
	);
	const filtered = useMemo(
		() => filterModels(models, providers, query),
		[models, providers, query],
	);
	const availableCount = models.filter((model) => model.available).length;
	const visibleCount = models.filter((model) => !model.hidden).length;

	const setVisibility = useCallback(async (model: WireModel, hidden: boolean) => {
		const key = `${model.provider}\0${model.id}`;
		setBusyModel(key);
		try {
			const next = await getTransport().request("model.setVisibility", {
				provider: model.provider,
				id: model.id,
				hidden,
			});
			setModels(next);
		} catch (error) {
			toast.error(errorText(error), hidden ? "Couldn't hide the model" : "Couldn't show the model");
		} finally {
			setBusyModel(null);
		}
	}, []);

	const setAllVisibility = useCallback(async (hidden: boolean) => {
		setBulkBusy(true);
		try {
			const next = await getTransport().request("model.setAllVisibility", { hidden });
			setModels(next);
		} catch (error) {
			toast.error(
				errorText(error),
				hidden ? "Couldn't hide all models" : "Couldn't show all models",
			);
		} finally {
			setBulkBusy(false);
		}
	}, []);

	return (
		<div data-testid="settings-models" className="flex flex-col gap-lg">
			<div className="flex items-start justify-between gap-sm">
				<div className="flex flex-col gap-xs">
					<h3 className="tr-title-section text-text-default">
						Models <span className="font-normal text-text-muted">({models.length})</span>
					</h3>
					<p className="text-text-muted tr-text-metadata">
						{availableCount} available · {visibleCount} shown. Visibility is a Gooseberry
						preference. Goose keeps the canonical catalog.
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-xs">
					<Button
						variant="outline"
						size="sm"
						disabled={bulkBusy || models.length === 0}
						onClick={() => void setAllVisibility(true)}
					>
						Hide all
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={bulkBusy || models.length === 0}
						onClick={() => void setAllVisibility(false)}
					>
						Show all
					</Button>
					<Button
						variant="ghost"
						size="sm"
						aria-label="Refresh model catalog"
						disabled={refreshing}
						onClick={() => void load(true)}
					>
						<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
						Refresh
					</Button>
				</div>
			</div>

			<label className="flex items-center gap-sm rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm">
				<Search className="size-4 shrink-0 text-text-muted" />
				<input
					data-testid="models-filter"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Filter models…"
					className="min-w-0 flex-1 bg-transparent text-text-default outline-none tr-text-ui placeholder:text-text-muted"
				/>
			</label>

			{loading ? (
				<p className="text-text-muted tr-text-ui">Loading models…</p>
			) : failed ? (
				<p className="text-text-muted tr-text-ui">Couldn't read the model catalog.</p>
			) : filtered.length === 0 ? (
				<p className="text-text-muted tr-text-ui">No models match this filter.</p>
			) : (
				<ModelCatalogList
					models={filtered}
					providers={providers}
					busyModel={busyModel}
					onSetVisibility={setVisibility}
				/>
			)}
		</div>
	);
}

export function ModelCatalogList({
	models,
	providers,
	busyModel,
	onSetVisibility,
}: {
	models: readonly WireModel[];
	providers: ReadonlyMap<string, ProviderStatus>;
	busyModel: string | null;
	onSetVisibility: (model: WireModel, hidden: boolean) => void;
}) {
	const groups = new Map<string, WireModel[]>();
	for (const model of models) {
		const group = groups.get(model.provider);
		if (group) group.push(model);
		else groups.set(model.provider, [model]);
	}
	return (
		<div className="flex flex-col gap-lg">
			{[...groups.entries()].map(([providerId, providerModels]) => (
				<section key={providerId} className="flex flex-col gap-xs">
					<div className="flex items-baseline justify-between gap-sm px-xs">
						<h4 className="tr-text-eyebrow text-text-muted">
							{providerName(providerId, providers)}
						</h4>
						<span className="text-text-muted tr-text-metadata">
							{providerModels.filter((model) => model.available).length}/{providerModels.length}{" "}
							available
						</span>
					</div>
					<div className="overflow-hidden rounded-[var(--radius-sm)] border border-border-default bg-control-bg">
						{providerModels.map((model, index) => (
							<ModelRow
								key={`${model.provider}\0${model.id}`}
								model={model}
								busy={busyModel === `${model.provider}\0${model.id}`}
								withBorder={index > 0}
								onSetVisibility={onSetVisibility}
							/>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

export function ModelRow({
	model,
	busy,
	withBorder,
	onSetVisibility,
}: {
	model: WireModel;
	busy: boolean;
	withBorder: boolean;
	onSetVisibility: (model: WireModel, hidden: boolean) => void;
}) {
	const cache = model.cost ? cacheText(model.cost) : null;
	return (
		<div
			data-testid="model-row"
			data-provider={model.provider}
			data-model={model.id}
			data-available={String(model.available)}
			data-hidden={String(model.hidden)}
			className={`grid grid-cols-[minmax(12rem,1fr)_auto_auto] items-start gap-md px-md py-sm ${
				withBorder ? "border-border-default border-t" : ""
			} ${!model.available || model.hidden ? "opacity-55" : ""}`}
		>
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-sm">
					<span className="truncate text-text-default tr-text-ui">{model.name || model.id}</span>
					{!model.available ? (
						<span className="rounded-[var(--radius-xs)] bg-control-bg-selected px-xs py-0.5 text-text-muted tr-text-metadata">
							Unavailable
						</span>
					) : null}
					{model.hidden ? (
						<span className="rounded-[var(--radius-xs)] bg-control-bg-selected px-xs py-0.5 text-text-muted tr-text-metadata">
							Hidden
						</span>
					) : null}
				</div>
				<div className="truncate text-text-muted tr-text-metadata">{model.id}</div>
				<div className="mt-xs flex flex-wrap items-center gap-xs text-text-muted tr-text-metadata">
					<span className="flex items-center gap-1" title="Text input">
						<Type className="size-3" /> Text
					</span>
					{model.input?.includes("image") ? (
						<span className="flex items-center gap-1" title="Image input">
							<Image className="size-3" /> Image
						</span>
					) : null}
					{model.reasoning ? (
						<span
							className="flex items-center gap-1"
							title={`Reasoning levels: ${model.thinkingLevels?.join(", ") || "provider default"}`}
						>
							<BrainCircuit className="size-3" />
							Reasoning
							{model.thinkingLevels && model.thinkingLevels.length > 0
								? ` · ${model.thinkingLevels.join("/")}`
								: ""}
						</span>
					) : null}
				</div>
			</div>

			<div className="flex min-w-[9rem] flex-col items-end gap-0.5 text-right">
				<span className="rounded-[var(--radius-xs)] bg-control-bg-selected px-sm py-xs text-text-default tr-text-metadata">
					{model.contextWindow === undefined ? "Unknown" : formatTokenCount(model.contextWindow)}{" "}
					ctx · {model.maxTokens === undefined ? "Unknown" : formatTokenCount(model.maxTokens)} out
				</span>
				{model.cost ? (
					<span className="text-text-muted tr-text-metadata">{rateText(model.cost)} / 1M</span>
				) : (
					<span className="text-text-muted tr-text-metadata">Pricing unavailable</span>
				)}
				{cache ? <span className="text-text-muted tr-text-metadata">{cache}</span> : null}
				{model.cost?.tiers?.map((tier) => (
					<span key={tier.inputTokensAbove} className="text-text-muted tr-text-metadata">
						{tierText(tier)}
					</span>
				))}
			</div>

			<Button
				variant="ghost"
				size="icon"
				aria-label={model.hidden ? `Show ${model.name}` : `Hide ${model.name}`}
				title={model.hidden ? "Show model" : "Hide model"}
				disabled={busy}
				onClick={() => onSetVisibility(model, !model.hidden)}
			>
				{model.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
			</Button>
		</div>
	);
}
