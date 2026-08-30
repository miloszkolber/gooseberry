import type {
	GooseAgentCatalogEntry,
	GoosePreferences,
	GooseProviderDefaults,
	ProviderStatus,
	WireModel,
} from "@gooseberry/contracts";
import { Bot, RotateCcw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { ConfirmDialog } from "../components/confirm-dialog";
import { errorText, getTransport } from "../connection";

const THINKING_EFFORTS = ["off", "low", "medium", "high", "max"] as const;
export type AgentDraft = {
	name: string;
	description: string;
	instructions: string;
	scope: "global" | "project";
	projectId: string;
	root: string;
	modelId: string;
};

const emptyAgent = (): AgentDraft => ({
	name: "",
	description: "",
	instructions: "",
	scope: "global",
	projectId: "",
	root: "",
	modelId: "",
});

export function defaultProviderChoices(providers: readonly ProviderStatus[]): ProviderStatus[] {
	return providers.filter((provider) => provider.configured && provider.available !== false);
}

export function defaultModelSuggestions(
	models: readonly WireModel[],
	providerId: string | null,
): WireModel[] {
	return models.filter(
		(model) => model.available && !model.hidden && model.provider === providerId,
	);
}

export function shouldClearAgentEditorAfterMutation(
	currentEditingId: string | null,
	mutation: { sequence: number; editingId: string | null },
	currentSequence: number,
): boolean {
	return currentSequence === mutation.sequence && currentEditingId === mutation.editingId;
}

export function DefaultSettings({
	defaults,
	providers,
	models,
	busy,
	loading,
	onDefaultsChange,
	onSave,
	onClear,
}: {
	defaults: GooseProviderDefaults;
	providers: readonly ProviderStatus[];
	models: readonly WireModel[];
	busy: boolean;
	loading: boolean;
	onDefaultsChange: (defaults: GooseProviderDefaults) => void;
	onSave: () => void;
	onClear: () => void;
}) {
	const selectableProviders = defaultProviderChoices(providers);
	const suggestions = defaultModelSuggestions(models, defaults.providerId);
	return (
		<section className="flex flex-col gap-sm border-border-default border-t pt-lg">
			<div>
				<h3 className="tr-title-section">New session defaults</h3>
				<p className="text-text-muted tr-text-metadata">
					Goose persists this provider and model default. New sessions inherit Goose’s saved
					default.
				</p>
			</div>
			<label className="flex flex-col gap-xs">
				Provider{" "}
				<select
					data-testid="default-provider"
					value={defaults.providerId ?? ""}
					disabled={busy}
					onChange={(event) =>
						onDefaultsChange({ providerId: event.target.value || null, modelId: null })
					}
					className="rounded border border-border-default bg-control-bg px-sm py-xs"
				>
					<option value="">Choose provider</option>
					{selectableProviders.map((provider) => (
						<option key={provider.id} value={provider.id}>
							{provider.name}
						</option>
					))}
				</select>
			</label>
			<label className="flex flex-col gap-xs">
				Model{" "}
				<input
					data-testid="default-model"
					value={defaults.modelId ?? ""}
					disabled={!defaults.providerId || busy}
					list="default-model-suggestions"
					onChange={(event) =>
						onDefaultsChange({ ...defaults, modelId: event.target.value || null })
					}
					placeholder="Provider default"
					className="rounded border border-border-default bg-control-bg px-sm py-xs"
				/>
				<datalist id="default-model-suggestions">
					{suggestions.map((model) => (
						<option key={`${model.provider}\0${model.id}`} value={model.id}>
							{model.name} ({model.id})
						</option>
					))}
				</datalist>
			</label>
			<div className="flex gap-xs">
				<Button size="sm" disabled={busy || loading} onClick={onSave}>
					Save defaults
				</Button>
				<Button size="sm" variant="outline" disabled={busy} onClick={onClear}>
					Clear defaults
				</Button>
			</div>
		</section>
	);
}

export function agentNameError(value: string): string | null {
	if (
		!value.trim() ||
		value.includes("/") ||
		value.includes("\\") ||
		new TextEncoder().encode(value.trim()).byteLength > 80
	) {
		return "Use a non-empty agent name of at most 80 UTF-8 bytes without / or \\.";
	}
	return null;
}

export function GooseSettings() {
	const projects = useAppStore((state) => state.projects);
	const [preferences, setPreferences] = useState<GoosePreferences>({});
	const [thresholdPercent, setThresholdPercent] = useState("");
	const [defaults, setDefaults] = useState<GooseProviderDefaults>({
		providerId: null,
		modelId: null,
	});
	const [models, setModels] = useState<WireModel[]>([]);
	const [providers, setProviders] = useState<ProviderStatus[]>([]);
	const [catalogProjectId, setCatalogProjectId] = useState("");
	const [catalogRoot, setCatalogRoot] = useState("");
	const [agents, setAgents] = useState<GooseAgentCatalogEntry[]>([]);
	const [draft, setDraft] = useState<AgentDraft>(emptyAgent);
	const [editing, setEditing] = useState<GooseAgentCatalogEntry | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<GooseAgentCatalogEntry | null>(null);
	const sequence = useRef(0);
	const agentMutationSequence = useRef(0);
	const editingIdRef = useRef<string | null>(null);
	editingIdRef.current = editing?.id ?? null;

	const load = useCallback(async () => {
		const current = ++sequence.current;
		setLoading(true);
		try {
			const [nextPreferences, nextDefaults, nextModels, nextProviderStatus, nextAgents] =
				await Promise.all([
					getTransport().request("goose.preferencesRead", {}),
					getTransport().request("goose.defaultsRead", {}),
					getTransport().request("model.list", {}),
					getTransport().request("provider.status", {}),
					catalogProjectId && !catalogRoot
						? Promise.resolve([] as GooseAgentCatalogEntry[])
						: getTransport().request(
								"goose.agentList",
								catalogProjectId ? { projectId: catalogProjectId, root: catalogRoot } : {},
							),
				]);
			if (current !== sequence.current) return;
			setPreferences(nextPreferences);
			setThresholdPercent(
				nextPreferences.autoCompactThreshold === undefined
					? ""
					: String(nextPreferences.autoCompactThreshold * 100),
			);
			setDefaults(nextDefaults);
			setModels(nextModels);
			setProviders(nextProviderStatus.providers);
			setAgents(nextAgents);
		} catch (error) {
			if (current === sequence.current)
				toast.error(errorText(error), "Couldn't load Goose settings");
		} finally {
			if (current === sequence.current) setLoading(false);
		}
	}, [catalogProjectId, catalogRoot]);

	useEffect(() => {
		void load();
	}, [load]);

	const availableModels = useMemo(
		() => models.filter((model) => model.available && !model.hidden),
		[models],
	);
	const catalogProject = projects.find((project) => project.id === catalogProjectId);
	const draftProject = projects.find((project) => project.id === draft.projectId);

	const savePreferences = async () => {
		const hasThreshold = thresholdPercent.trim() !== "";
		const percent = Number(thresholdPercent);
		if (hasThreshold && (!Number.isFinite(percent) || percent <= 0 || percent > 100)) {
			toast.error("Use a percentage greater than 0 and no more than 100.", "Invalid threshold");
			return;
		}
		setBusy(true);
		try {
			const next = await getTransport().request("goose.preferencesSave", {
				...(hasThreshold ? { autoCompactThreshold: percent / 100 } : {}),
				...(preferences.gooseThinkingEffort !== undefined
					? { gooseThinkingEffort: preferences.gooseThinkingEffort }
					: {}),
			});
			setPreferences(next);
		} catch (error) {
			toast.error(errorText(error), "Couldn't save Goose preferences");
		} finally {
			setBusy(false);
		}
	};

	const resetPreference = async (key: "autoCompactThreshold" | "gooseThinkingEffort") => {
		setBusy(true);
		try {
			const next = await getTransport().request("goose.preferencesReset", { keys: [key] });
			setPreferences(next);
			if (key === "autoCompactThreshold") setThresholdPercent("");
		} catch (error) {
			toast.error(errorText(error), "Couldn't reset Goose preference");
		} finally {
			setBusy(false);
		}
	};

	const saveDefaults = async () => {
		if (!defaults.providerId) {
			toast.error("Choose a configured provider.", "Default provider required");
			return;
		}
		setBusy(true);
		try {
			setDefaults(
				await getTransport().request("goose.defaultsSave", {
					providerId: defaults.providerId,
					modelId: defaults.modelId,
				}),
			);
		} catch (error) {
			toast.error(errorText(error), "Couldn't save Goose defaults");
		} finally {
			setBusy(false);
		}
	};
	const clearDefaults = async () => {
		setBusy(true);
		try {
			setDefaults(await getTransport().request("goose.defaultsClear", {}));
		} catch (error) {
			toast.error(errorText(error), "Couldn't clear Goose defaults");
		} finally {
			setBusy(false);
		}
	};

	const edit = (agent: GooseAgentCatalogEntry) => {
		setEditing(agent);
		setDraft({
			name: agent.name,
			description: agent.description,
			instructions: agent.instructions,
			scope: agent.scope,
			projectId: catalogProjectId,
			root: catalogRoot,
			modelId: agent.modelId ?? "",
		});
	};
	const saveAgent = async () => {
		const nameError = agentNameError(draft.name);
		if (nameError) {
			toast.error(nameError, "Invalid agent name");
			return;
		}
		if (draft.scope === "project" && (!draft.projectId || !draft.root)) {
			toast.error("Choose an admitted project for this agent.", "Project required");
			return;
		}
		const mutation = { sequence: ++agentMutationSequence.current, editingId: editing?.id ?? null };
		setBusy(true);
		try {
			const modelId = draft.modelId || undefined;
			if (editing) {
				await getTransport().request("goose.agentUpdate", {
					id: editing.id,
					name: draft.name,
					description: draft.description,
					instructions: draft.instructions,
					...(draft.scope === "project" ? { projectId: draft.projectId, root: draft.root } : {}),
					...(modelId !== (editing.modelId ?? "") ? { modelId: modelId ?? null } : {}),
				});
			} else {
				await getTransport().request("goose.agentCreate", {
					name: draft.name,
					description: draft.description,
					instructions: draft.instructions,
					scope: draft.scope,
					...(draft.scope === "project" ? { projectId: draft.projectId, root: draft.root } : {}),
					...(modelId ? { modelId } : {}),
				});
			}
			if (
				shouldClearAgentEditorAfterMutation(
					editingIdRef.current,
					mutation,
					agentMutationSequence.current,
				)
			) {
				setEditing(null);
				setDraft(emptyAgent());
			}
			await load();
		} catch (error) {
			toast.error(
				errorText(error),
				editing ? "Couldn't update Goose agent" : "Couldn't create Goose agent",
			);
		} finally {
			setBusy(false);
		}
	};
	const removeAgent = async (agent: GooseAgentCatalogEntry) => {
		const mutation = { sequence: ++agentMutationSequence.current, editingId: agent.id };
		setBusy(true);
		try {
			await getTransport().request("goose.agentDelete", {
				id: agent.id,
				...(agent.scope === "project" && catalogProjectId && catalogRoot
					? { projectId: catalogProjectId, root: catalogRoot }
					: {}),
			});
			if (
				shouldClearAgentEditorAfterMutation(
					editingIdRef.current,
					mutation,
					agentMutationSequence.current,
				)
			) {
				setEditing(null);
				setDraft(emptyAgent());
			}
			await load();
		} catch (error) {
			toast.error(errorText(error), "Couldn't remove Goose agent");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div data-testid="settings-goose" className="flex flex-col gap-xl">
			<section className="flex flex-col gap-sm">
				<div>
					<h3 className="tr-title-section">Goose preferences</h3>
					<p className="text-text-muted tr-text-metadata">
						These are the only Goose preferences available here. Goose persists them.
					</p>
				</div>
				<label className="flex flex-col gap-xs">
					Auto compact threshold{" "}
					<span className="text-text-muted tr-text-metadata">
						Percentage of context capacity. Goose accepts values greater than 0% through 100%, not
						0%.
					</span>
					<input
						data-testid="auto-compact-threshold"
						type="number"
						min="0.1"
						max="100"
						step="0.1"
						value={thresholdPercent}
						disabled={busy}
						onChange={(event) => setThresholdPercent(event.target.value)}
						className="rounded border border-border-default bg-control-bg px-sm py-xs"
					/>
				</label>
				<label className="flex flex-col gap-xs">
					Thinking effort{" "}
					<select
						data-testid="goose-thinking-effort"
						value={preferences.gooseThinkingEffort ?? ""}
						disabled={busy}
						onChange={(event) => {
							const effort = event.target.value as GoosePreferences["gooseThinkingEffort"] | "";
							setPreferences((current) => {
								if (effort) return { ...current, gooseThinkingEffort: effort };
								const { gooseThinkingEffort: _unset, ...unset } = current;
								return unset;
							});
						}}
						className="rounded border border-border-default bg-control-bg px-sm py-xs"
					>
						<option value="">Goose default</option>
						{THINKING_EFFORTS.map((value) => (
							<option key={value}>{value}</option>
						))}
					</select>
				</label>
				<div className="flex flex-wrap gap-xs">
					<Button size="sm" disabled={busy || loading} onClick={() => void savePreferences()}>
						<Save className="size-3.5" />
						Save preferences
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => void resetPreference("autoCompactThreshold")}
					>
						<RotateCcw className="size-3.5" />
						Reset threshold
					</Button>
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onClick={() => void resetPreference("gooseThinkingEffort")}
					>
						Reset thinking
					</Button>
				</div>
			</section>
			<DefaultSettings
				defaults={defaults}
				providers={providers}
				models={models}
				busy={busy}
				loading={loading}
				onDefaultsChange={setDefaults}
				onSave={() => void saveDefaults()}
				onClear={() => void clearDefaults()}
			/>
			<section className="flex flex-col gap-sm border-border-default border-t pt-lg">
				<div className="flex flex-wrap items-end justify-between gap-sm">
					<div>
						<h3 className="tr-title-section">Agent catalog</h3>
						<p className="text-text-muted tr-text-metadata">
							Agents are stored by Goose. Model is a model ID preference and the agent inherits its
							provider.
						</p>
					</div>
					<label className="flex flex-col gap-xs text-text-muted tr-text-metadata">
						Project scope{" "}
						<select
							data-testid="agent-catalog-project"
							value={catalogProjectId}
							disabled={busy}
							onChange={(event) => {
								sequence.current++;
								setCatalogProjectId(event.target.value);
								setCatalogRoot("");
								setEditing(null);
								setDraft(emptyAgent());
							}}
							className="rounded border border-border-default bg-control-bg px-sm py-xs text-text-default"
						>
							<option value="">Global agents</option>
							{projects.map((project) => (
								<option key={project.id} value={project.id}>
									{project.name}
								</option>
							))}
						</select>
					</label>
					{catalogProject ? (
						<label className="flex flex-col gap-xs text-text-muted tr-text-metadata">
							Admitted root
							<select
								data-testid="agent-catalog-root"
								value={catalogRoot}
								disabled={busy}
								onChange={(event) => {
									sequence.current++;
									setCatalogRoot(event.target.value);
									setEditing(null);
									setDraft(emptyAgent());
								}}
								className="rounded border border-border-default bg-control-bg px-sm py-xs text-text-default"
							>
								<option value="">Choose root</option>
								{catalogProject.roots.map((root) => (
									<option key={root} value={root}>
										{root}
									</option>
								))}
							</select>
						</label>
					) : null}
				</div>
				{loading ? (
					<p className="text-text-muted">Loading Goose settings…</p>
				) : (
					<div className="flex flex-col gap-xs">
						{agents.length === 0 ? (
							<p className="text-text-muted tr-text-ui">No agents in this scope.</p>
						) : (
							agents.map((agent) => (
								<div
									key={agent.id}
									data-testid="agent-row"
									className="flex items-center gap-sm rounded border border-border-default bg-control-bg px-sm py-xs"
								>
									<Bot className="size-4 text-text-muted" />
									<div className="min-w-0 flex-1">
										<div>
											{agent.name}{" "}
											<span className="text-text-muted tr-text-metadata">
												{agent.scope} · {agent.writable ? "Writable" : "Read-only"}
											</span>
										</div>
										<div className="truncate text-text-muted tr-text-metadata">
											{agent.description}
										</div>
										{agent.modelId ? (
											<div className="text-text-muted tr-text-metadata">
												Model ID: {agent.modelId}
											</div>
										) : null}
									</div>
									{agent.writable ? (
										<div className="flex gap-xs">
											<Button
												size="sm"
												variant="outline"
												disabled={busy}
												onClick={() => edit(agent)}
											>
												Edit
											</Button>
											<Button
												size="icon"
												variant="ghost"
												aria-label={`Remove ${agent.name}`}
												disabled={busy}
												onClick={() => setDeleteTarget(agent)}
											>
												<Trash2 className="size-3.5" />
											</Button>
										</div>
									) : null}
								</div>
							))
						)}
					</div>
				)}
				<form
					className="flex flex-col gap-sm rounded border border-border-default p-md"
					onSubmit={(event) => {
						event.preventDefault();
						void saveAgent();
					}}
				>
					<h4 className="tr-text-ui">{editing ? `Edit ${editing.name}` : "Add agent"}</h4>
					<label className="flex flex-col gap-xs">
						Name
						<span className="text-text-muted tr-text-metadata">
							Up to 80 UTF-8 bytes. Slashes are not allowed.
						</span>
						<input
							value={draft.name}
							maxLength={80}
							disabled={busy}
							onChange={(event) =>
								setDraft((current) => ({ ...current, name: event.target.value }))
							}
							className="rounded border border-border-default bg-control-bg px-sm py-xs"
						/>
					</label>
					<label className="flex flex-col gap-xs">
						Description
						<input
							value={draft.description}
							maxLength={1000}
							disabled={busy}
							onChange={(event) =>
								setDraft((current) => ({ ...current, description: event.target.value }))
							}
							className="rounded border border-border-default bg-control-bg px-sm py-xs"
						/>
					</label>
					<label className="flex flex-col gap-xs">
						Instructions (Markdown as plain text)
						<textarea
							data-testid="agent-instructions"
							value={draft.instructions}
							maxLength={64 * 1024}
							rows={7}
							disabled={busy}
							onChange={(event) =>
								setDraft((current) => ({ ...current, instructions: event.target.value }))
							}
							className="rounded border border-border-default bg-control-bg px-sm py-xs"
						/>
					</label>
					{!editing ? (
						<>
							<label className="flex flex-col gap-xs">
								Scope
								<select
									value={draft.scope}
									disabled={busy || Boolean(editing)}
									onChange={(event) =>
										setDraft((current) => ({
											...current,
											scope: event.target.value as AgentDraft["scope"],
										}))
									}
									className="rounded border border-border-default bg-control-bg px-sm py-xs"
								>
									<option value="global">Global</option>
									<option value="project">Project</option>
								</select>
							</label>
							{draft.scope === "project" ? (
								<>
									<label className="flex flex-col gap-xs">
										Admitted project
										<select
											value={draft.projectId}
											disabled={busy}
											onChange={(event) =>
												setDraft((current) => ({
													...current,
													projectId: event.target.value,
													root: "",
												}))
											}
											className="rounded border border-border-default bg-control-bg px-sm py-xs"
										>
											<option value="">Choose project</option>
											{projects.map((project) => (
												<option key={project.id} value={project.id}>
													{project.name}
												</option>
											))}
										</select>
									</label>
									{draftProject ? (
										<label className="flex flex-col gap-xs">
											Admitted root
											<select
												value={draft.root}
												disabled={busy}
												onChange={(event) =>
													setDraft((current) => ({ ...current, root: event.target.value }))
												}
												className="rounded border border-border-default bg-control-bg px-sm py-xs"
											>
												<option value="">Choose root</option>
												{draftProject.roots.map((root) => (
													<option key={root} value={root}>
														{root}
													</option>
												))}
											</select>
										</label>
									) : null}
								</>
							) : null}
						</>
					) : null}
					<label className="flex flex-col gap-xs">
						Preferred model ID
						<input
							data-testid="agent-model"
							value={draft.modelId}
							list="agent-model-suggestions"
							disabled={busy}
							onChange={(event) =>
								setDraft((current) => ({ ...current, modelId: event.target.value }))
							}
							placeholder="Inherit provider model"
							className="rounded border border-border-default bg-control-bg px-sm py-xs"
						/>
						<datalist id="agent-model-suggestions">
							{availableModels.map((model) => (
								<option key={`${model.provider}\0${model.id}`} value={model.id}>
									{model.provider}: {model.id}
								</option>
							))}
						</datalist>
					</label>
					<div className="flex gap-xs">
						<Button size="sm" type="submit" disabled={busy}>
							{editing ? "Save agent" : "Add agent"}
						</Button>
						{editing ? (
							<Button
								size="sm"
								type="button"
								variant="outline"
								disabled={busy}
								onClick={() => {
									setEditing(null);
									setDraft(emptyAgent());
								}}
							>
								Cancel
							</Button>
						) : null}
					</div>
				</form>
				<ConfirmDialog
					open={deleteTarget !== null}
					onOpenChange={(open) => !open && setDeleteTarget(null)}
					title="Remove Goose agent?"
					description={deleteTarget ? `Remove ${deleteTarget.name} from Goose.` : undefined}
					confirmLabel="Remove agent"
					confirmTestId="confirm-remove-agent"
					destructive
					onConfirm={() => {
						if (deleteTarget) void removeAgent(deleteTarget);
					}}
				/>
			</section>
		</div>
	);
}
