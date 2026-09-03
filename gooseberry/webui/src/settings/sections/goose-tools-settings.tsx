import type {
	GooseExtensionCatalog,
	GooseExtensionSummary,
	GooseSessionExtensionSummary,
	GooseToolPermission,
	GooseToolSummary,
} from "@gooseberry/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { selectActiveContentTab, selectActiveProjectArea, useAppStore } from "@/store";
import { errorText, getTransport } from "../../connection";

const permissionLabel: Record<GooseToolPermission, string> = {
	always_allow: "Always allow",
	ask_before: "Ask first",
	never_allow: "Never allow",
};

/** Focused safe projection of Goose-owned global extensions and global tool permissions. */
export function GooseToolsSettings() {
	const activeArea = useAppStore(selectActiveProjectArea);
	const activeTab = useAppStore((state) =>
		activeArea ? selectActiveContentTab(state, activeArea.id) : null,
	);
	const activeProjectId = activeArea?.projectId ?? null;
	const activeSessionId = activeTab?.kind === "chat" ? activeTab.sessionId : null;
	const [catalog, setCatalog] = useState<GooseExtensionCatalog | null>(null);
	const [extensions, setExtensions] = useState<GooseSessionExtensionSummary[]>([]);
	const [tools, setTools] = useState<GooseToolSummary[]>([]);
	const [loadedSessionTarget, setLoadedSessionTarget] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const loadSequence = useRef(0);
	const activeTarget = `${activeProjectId ?? ""}\0${activeSessionId ?? ""}`;
	const activeTargetRef = useRef(activeTarget);
	activeTargetRef.current = activeTarget;

	const load = useCallback(async () => {
		const sequence = ++loadSequence.current;
		const target = activeTarget;
		setLoading(true);
		setError(null);
		setLoadedSessionTarget(null);
		try {
			const nextCatalog = await getTransport().request("goose.extensionList", {});
			if (sequence !== loadSequence.current || target !== activeTargetRef.current) return;
			setCatalog(nextCatalog);
			if (activeProjectId && activeSessionId) {
				const [nextExtensions, nextTools] = await Promise.all([
					getTransport().request("session.extensionList", {
						projectId: activeProjectId,
						sessionId: activeSessionId,
					}),
					getTransport().request("session.toolList", {
						projectId: activeProjectId,
						sessionId: activeSessionId,
					}),
				]);
				if (sequence !== loadSequence.current || target !== activeTargetRef.current) return;
				setExtensions(nextExtensions);
				setTools(nextTools);
				setLoadedSessionTarget(target);
			} else {
				setExtensions([]);
				setTools([]);
				setLoadedSessionTarget(null);
			}
		} catch (cause) {
			if (sequence !== loadSequence.current || target !== activeTargetRef.current) return;
			setError(errorText(cause));
		} finally {
			if (sequence === loadSequence.current && target === activeTargetRef.current) {
				setLoading(false);
			}
		}
	}, [activeProjectId, activeSessionId, activeTarget]);
	const loadRef = useRef(load);
	loadRef.current = load;

	useEffect(() => {
		void load();
	}, [load]);

	const mutate = async (key: string, action: () => Promise<unknown>) => {
		const target = activeTarget;
		setBusy(key);
		setError(null);
		try {
			await action();
			await loadRef.current();
		} catch (cause) {
			if (target === activeTargetRef.current) setError(errorText(cause));
		} finally {
			setBusy(null);
		}
	};

	const configuredNames = new Set(catalog?.configured.map((extension) => extension.name) ?? []);
	const sessionNames = new Set(extensions.map((extension) => extension.name));
	const knownSessionExtensions = uniqueExtensions([
		...(catalog?.configured ?? []),
		...(catalog?.available ?? []),
	]).filter((extension) => !sessionNames.has(extension.name));
	const visibleTools = tools.filter((tool) => {
		const needle = query.trim().toLocaleLowerCase();
		return (
			!needle ||
			`${tool.name} ${tool.description} ${tool.parameters.join(" ")}`
				.toLocaleLowerCase()
				.includes(needle)
		);
	});
	const hasActiveChat = activeProjectId !== null && activeSessionId !== null;
	const sessionInventoryCurrent =
		hasActiveChat && isSessionInventoryCurrent(loadedSessionTarget, activeTarget, loading);
	const sessionParams = () => {
		if (!activeProjectId || !activeSessionId) throw new Error("An active chat is required");
		return { projectId: activeProjectId, sessionId: activeSessionId };
	};

	return (
		<div data-testid="settings-goose-tools" className="flex flex-col gap-lg">
			<div className="flex flex-wrap items-start justify-between gap-sm">
				<div>
					<h3 className="tr-title-section text-text-default">Extensions and tools</h3>
					<p className="text-text-muted tr-text-metadata">
						Goose owns global extension configuration and global tool permissions.
					</p>
				</div>
				<Button
					size="sm"
					variant="outline"
					disabled={loading || busy !== null}
					onClick={() => void load()}
				>
					Refresh
				</Button>
			</div>
			{error ? (
				<p role="alert" className="text-feedback-error tr-text-metadata">
					{error}
				</p>
			) : null}
			{busy ? (
				<p role="status" aria-live="polite" className="text-text-muted tr-text-metadata">
					Updating Goose settings…
				</p>
			) : null}
			<section className="flex flex-col gap-sm" aria-labelledby="global-extensions-heading">
				<div>
					<h4 id="global-extensions-heading" className="tr-text-eyebrow text-text-muted">
						Global extensions
					</h4>
					<p className="text-text-muted tr-text-metadata">
						Changes persist in Goose configuration.
					</p>
				</div>
				{loading ? (
					<p role="status" className="text-text-muted tr-text-metadata">
						Loading extensions…
					</p>
				) : null}
				{!loading && catalog?.configured.length === 0 ? (
					<p className="text-text-muted tr-text-metadata">No extensions are configured in Goose.</p>
				) : null}
				<ExtensionWarningCount warningCount={catalog?.warningCount ?? 0} />
				{catalog?.configured.map((extension) => (
					<div
						key={extension.configKey ?? extension.name}
						className="flex flex-wrap items-center justify-between gap-sm rounded-[var(--radius-sm)] border border-border-default p-sm"
					>
						<ExtensionLabel extension={extension} />
						<div className="flex gap-xs">
							<Button
								size="sm"
								variant="outline"
								disabled={!extension.configKey || loading || busy !== null}
								aria-label={`${extension.enabled ? "Disable" : "Enable"} ${extension.displayName ?? extension.name}`}
								onClick={() =>
									void mutate(`enable:${extension.configKey}`, () =>
										getTransport().request("goose.extensionSetEnabled", {
											configKey: extension.configKey ?? "",
											enabled: !extension.enabled,
										}),
									)
								}
							>
								{extension.enabled ? "Disable" : "Enable"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={!extension.configKey || loading || busy !== null}
								aria-label={`Remove ${extension.displayName ?? extension.name}`}
								onClick={() =>
									void mutate(`remove:${extension.configKey}`, () =>
										getTransport().request("goose.extensionRemove", {
											configKey: extension.configKey ?? "",
										}),
									)
								}
							>
								Remove
							</Button>
						</div>
					</div>
				))}
				{catalog?.available
					.filter(
						(extension) =>
							(extension.type === "builtin" || extension.type === "platform") &&
							!configuredNames.has(extension.name),
					)
					.map((extension) => (
						<div
							key={extension.name}
							className="flex flex-wrap items-center justify-between gap-sm rounded-[var(--radius-sm)] border border-border-default p-sm"
						>
							<ExtensionLabel extension={extension} />
							<Button
								size="sm"
								disabled={loading || busy !== null}
								aria-label={`Add ${extension.displayName ?? extension.name}`}
								onClick={() =>
									void mutate(`add:${extension.name}`, () =>
										getTransport().request("goose.extensionAdd", {
											name: extension.name,
											enabled: true,
										}),
									)
								}
							>
								Add
							</Button>
						</div>
					))}
			</section>
			<section className="flex flex-col gap-sm" aria-labelledby="session-tools-heading">
				<h4 id="session-tools-heading" className="tr-text-eyebrow text-text-muted">
					Active chat tools
				</h4>
				{!hasActiveChat ? (
					<p className="text-text-muted tr-text-metadata">
						Open a chat in the current project to manage its effective extensions and tools.
					</p>
				) : !sessionInventoryCurrent ? (
					<p role="status" className="text-text-muted tr-text-metadata">
						{loading
							? "Loading active chat extensions and tools…"
							: "Active chat tools are unavailable. Refresh to try again."}
					</p>
				) : (
					<>
						<p className="text-text-muted tr-text-metadata">
							Session extensions affect this chat. Tool permission changes are global in Goose.
						</p>
						<div className="flex flex-wrap gap-sm">
							{extensions.map((extension) => (
								<div
									key={extension.extensionKey}
									className="flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default p-xs"
								>
									<span className="text-text-default tr-text-ui">
										{extension.displayName ?? extension.name}
									</span>
									<Button
										size="sm"
										variant="ghost"
										disabled={busy !== null}
										aria-label={`Remove ${extension.displayName ?? extension.name} from active chat`}
										onClick={() =>
											void mutate(`session-remove:${extension.extensionKey}`, () =>
												getTransport().request("session.extensionRemove", {
													...sessionParams(),
													extensionKey: extension.extensionKey,
												}),
											)
										}
									>
										Remove
									</Button>
								</div>
							))}
							{knownSessionExtensions.map((extension) => (
								<Button
									key={extension.name}
									size="sm"
									variant="outline"
									disabled={busy !== null}
									onClick={() =>
										void mutate(`session-add:${extension.name}`, () =>
											getTransport().request("session.extensionAdd", {
												...sessionParams(),
												name: extension.name,
											}),
										)
									}
								>
									Add {extension.displayName ?? extension.name}
								</Button>
							))}
						</div>
						<label className="flex flex-col gap-xs text-text-default tr-text-ui">
							Search tools
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs text-text-default"
							/>
						</label>
						{!loading && visibleTools.length === 0 ? (
							<p className="text-text-muted tr-text-metadata">No tools match this chat.</p>
						) : null}
						{visibleTools.map((tool) => (
							<ToolInventory
								key={tool.name}
								tool={tool}
								busy={busy !== null}
								onPermissionChange={(permission) =>
									mutate(`permission:${tool.name}`, () =>
										getTransport().request("session.toolPermissionSet", {
											...sessionParams(),
											toolName: tool.name,
											permission,
										}),
									)
								}
							/>
						))}
					</>
				)}
			</section>
		</div>
	);
}

function ExtensionLabel({ extension }: { extension: GooseExtensionSummary }) {
	return (
		<div className="min-w-0">
			<div className="break-words text-text-default tr-text-ui">
				{extension.displayName ?? extension.name}
			</div>
			{extension.description ? (
				<p className="break-words text-text-muted tr-text-metadata">{extension.description}</p>
			) : null}
		</div>
	);
}

export function ToolInventory({
	tool,
	busy,
	onPermissionChange,
}: {
	tool: GooseToolSummary;
	busy: boolean;
	onPermissionChange: (permission: GooseToolPermission) => Promise<unknown>;
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-sm rounded-[var(--radius-sm)] border border-border-default p-sm">
			<div className="min-w-0">
				<div className="break-words text-text-default tr-text-ui">{tool.name}</div>
				<p className="break-words text-text-muted tr-text-metadata">
					{tool.description || "No description supplied by Goose."}
					{tool.parameters.length ? ` Parameters: ${tool.parameters.join(", ")}` : ""}
				</p>
			</div>
			<label className="flex shrink-0 flex-col gap-xs text-text-muted tr-text-metadata">
				Permission
				<select
					aria-label={`Permission for ${tool.name}`}
					value={tool.permission ?? "goose_default"}
					disabled={busy}
					onChange={(event) => {
						const permission = event.target.value;
						if (permission !== "goose_default") {
							void onPermissionChange(permission as GooseToolPermission);
						}
					}}
					className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs text-text-default"
				>
					<option value="goose_default" disabled>
						Goose default
					</option>
					{(Object.keys(permissionLabel) as GooseToolPermission[]).map((permission) => (
						<option key={permission} value={permission}>
							{permissionLabel[permission]}
						</option>
					))}
				</select>
			</label>
		</div>
	);
}

export function ExtensionWarningCount({ warningCount }: { warningCount: number }) {
	if (warningCount === 0) return null;
	return (
		<p className="text-text-muted tr-text-metadata">
			{warningCount} Goose configuration {warningCount === 1 ? "warning" : "warnings"} reported.
		</p>
	);
}

function uniqueExtensions(extensions: GooseExtensionSummary[]): GooseExtensionSummary[] {
	const seen = new Set<string>();
	return extensions.filter(
		(extension) => !seen.has(extension.name) && Boolean(seen.add(extension.name)),
	);
}

export function isSessionInventoryCurrent(
	loadedTarget: string | null,
	activeTarget: string,
	loading: boolean,
): boolean {
	return !loading && loadedTarget === activeTarget;
}
