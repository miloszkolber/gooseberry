import type { BrowserPanelAction, BrowserPanelResult } from "@gooseberry/contracts";
import { safeBrowserURL } from "@gooseberry/contracts";
import { Camera, ChevronLeft, ChevronRight, LoaderCircle, RefreshCw } from "lucide-react";
import type { FormEvent } from "react";
import { useCallback } from "react";
import { errorText, getTransport } from "../../connection";
import { newBrowserPanelViewState, useAppStore } from "../../store";

export function snapshotReferences(snapshot: string): string[] {
	return [...new Set(snapshot.match(/@[A-Za-z0-9_-]{1,128}/g) ?? [])];
}

export function browserPanelScreenState(
	loading: boolean,
	error: string | null,
	screenshot: string | null,
): "loading" | "error" | "empty" | "ready" {
	if (loading) return "loading";
	if (error) return "error";
	return screenshot ? "ready" : "empty";
}

export function BrowserPanel({ panelId }: { panelId: string }) {
	const panel = useAppStore(
		(state) => state.browserPanelStateById[panelId] ?? newBrowserPanelViewState(),
	);
	const setPanel = useCallback(
		(patch: Partial<typeof panel>) => useAppStore.getState().setBrowserPanelState(panelId, patch),
		[panelId],
	);

	const command = useCallback(
		async (action: BrowserPanelAction): Promise<BrowserPanelResult | null> => {
			const generation = useAppStore.getState().beginBrowserPanelRequest(panelId);
			try {
				const result = await getTransport().request("browser.panelCommand", { panelId, action });
				const completed = useAppStore.getState().completeBrowserPanelRequest(panelId, generation, {
					...(action.type === "snapshot" ? { snapshot: result.output } : {}),
					...(result.screenshotUrl ? { screenshot: result.screenshotUrl } : {}),
				});
				return completed ? result : null;
			} catch (requestError) {
				useAppStore
					.getState()
					.completeBrowserPanelRequest(panelId, generation, { error: errorText(requestError) });
				return null;
			}
		},
		[panelId],
	);

	const runWithScreenshot = useCallback(
		async (action: BrowserPanelAction) => {
			if (await command(action)) await command({ type: "screenshot" });
		},
		[command],
	);

	const open = (event: FormEvent) => {
		event.preventDefault();
		const url = safeBrowserURL(panel.address.trim());
		if (!url) {
			setPanel({ error: "Enter a plain http:// or https:// URL without credentials." });
			return;
		}
		setPanel({ address: url });
		void runWithScreenshot({ type: "open", url });
	};
	const references = snapshotReferences(panel.snapshot);
	const screenState = browserPanelScreenState(panel.loading, panel.error, panel.screenshot);

	return (
		<div
			data-testid="browser-panel"
			data-state={screenState}
			className="flex h-full min-h-0 flex-col bg-container-content-bg"
		>
			<form
				onSubmit={open}
				className="flex shrink-0 flex-wrap items-center gap-xs border-border-default border-b p-sm"
			>
				<button
					type="button"
					aria-label="Back"
					disabled={panel.loading}
					onClick={() => void runWithScreenshot({ type: "back" })}
					className="rounded-[var(--radius-sm)] p-xs text-text-muted hover:bg-control-bg-hovered disabled:opacity-50"
				>
					<ChevronLeft className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Forward"
					disabled={panel.loading}
					onClick={() => void runWithScreenshot({ type: "forward" })}
					className="rounded-[var(--radius-sm)] p-xs text-text-muted hover:bg-control-bg-hovered disabled:opacity-50"
				>
					<ChevronRight className="size-4" />
				</button>
				<button
					type="button"
					aria-label="Reload"
					disabled={panel.loading}
					onClick={() => void runWithScreenshot({ type: "reload" })}
					className="rounded-[var(--radius-sm)] p-xs text-text-muted hover:bg-control-bg-hovered disabled:opacity-50"
				>
					<RefreshCw className="size-4" />
				</button>
				<label className="sr-only" htmlFor={`browser-address-${panelId}`}>
					Address
				</label>
				<input
					id={`browser-address-${panelId}`}
					value={panel.address}
					onChange={(event) => setPanel({ address: event.target.value })}
					placeholder="https://example.com"
					inputMode="url"
					autoComplete="url"
					disabled={panel.loading}
					className="min-w-[12rem] flex-1 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default"
				/>
				<button
					type="submit"
					disabled={panel.loading}
					className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered disabled:opacity-50"
				>
					Open
				</button>
			</form>
			<div className="flex shrink-0 flex-wrap items-center gap-xs border-border-default border-b p-sm">
				<button
					type="button"
					disabled={panel.loading}
					onClick={() => void command({ type: "snapshot" })}
					className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered disabled:opacity-50"
				>
					Snapshot
				</button>
				<button
					type="button"
					disabled={panel.loading}
					onClick={() => void command({ type: "screenshot" })}
					className="inline-flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered disabled:opacity-50"
				>
					<Camera className="size-3.5" /> Screenshot
				</button>
				<label className="inline-flex items-center gap-xs tr-text-metadata text-text-muted">
					Viewport{" "}
					<input
						aria-label="Viewport width"
						type="number"
						min="320"
						max="1920"
						value={panel.viewport.width}
						onChange={(event) =>
							setPanel({ viewport: { ...panel.viewport, width: Number(event.target.value) } })
						}
						className="w-16 rounded border border-border-default bg-control-bg px-xs py-1 text-text-default"
					/>{" "}
					×{" "}
					<input
						aria-label="Viewport height"
						type="number"
						min="240"
						max="1200"
						value={panel.viewport.height}
						onChange={(event) =>
							setPanel({ viewport: { ...panel.viewport, height: Number(event.target.value) } })
						}
						className="w-16 rounded border border-border-default bg-control-bg px-xs py-1 text-text-default"
					/>
				</label>
				<button
					type="button"
					disabled={panel.loading}
					onClick={() => void command({ type: "viewport", ...panel.viewport })}
					className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered disabled:opacity-50"
				>
					Apply
				</button>
				{panel.loading ? (
					<span
						role="status"
						className="inline-flex items-center gap-xs text-text-muted tr-text-metadata"
					>
						<LoaderCircle className="size-3.5 animate-spin" /> Working…
					</span>
				) : null}
			</div>
			{panel.error ? (
				<p
					role="alert"
					className="shrink-0 border-border-default border-b bg-feedback-error px-sm py-xs text-text-on-danger tr-text-ui"
				>
					{panel.error}
				</p>
			) : null}
			<div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<section
					aria-label="Latest browser screenshot"
					className="flex min-h-0 items-center justify-center overflow-auto p-md"
				>
					{panel.screenshot ? (
						<img
							src={panel.screenshot}
							alt="Latest browser screenshot"
							className="max-h-full max-w-full rounded-[var(--radius-sm)] border border-border-default object-contain"
						/>
					) : (
						<p className="text-center text-text-muted tr-text-ui">
							Open a URL, then use Screenshot to render the current page.
						</p>
					)}
				</section>
				<section
					aria-label="Snapshot and interactions"
					className="min-h-0 overflow-auto border-border-default border-t p-sm lg:border-t-0 lg:border-l"
				>
					<h2 className="tr-text-ui text-text-default">Snapshot</h2>
					{panel.snapshot ? (
						<textarea
							readOnly
							aria-label="Browser snapshot output"
							value={panel.snapshot}
							rows={8}
							className="mt-xs max-h-48 w-full resize-none overflow-auto rounded border border-border-default bg-control-bg p-xs tr-code-text text-text-muted"
						/>
					) : (
						<p className="mt-xs text-text-muted tr-text-metadata">
							Take a snapshot to inspect available element references.
						</p>
					)}
					<div className="mt-md flex flex-col gap-xs">
						<label className="tr-text-metadata text-text-muted" htmlFor={`browser-ref-${panelId}`}>
							Snapshot reference
						</label>
						<input
							id={`browser-ref-${panelId}`}
							value={panel.reference}
							onChange={(event) => setPanel({ reference: event.target.value })}
							placeholder="@element"
							className="rounded border border-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default"
						/>
						<div className="flex gap-xs">
							<button
								type="button"
								disabled={panel.loading || !panel.reference}
								onClick={() => void runWithScreenshot({ type: "click", ref: panel.reference })}
								className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered disabled:opacity-50"
							>
								Click
							</button>
							<input
								aria-label="Text to fill"
								value={panel.fillText}
								onChange={(event) => setPanel({ fillText: event.target.value })}
								placeholder="Text to fill"
								className="min-w-0 flex-1 rounded border border-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default"
							/>
							<button
								type="button"
								disabled={panel.loading || !panel.reference}
								onClick={() =>
									void runWithScreenshot({
										type: "fill",
										ref: panel.reference,
										text: panel.fillText,
									})
								}
								className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered disabled:opacity-50"
							>
								Fill
							</button>
						</div>
						{references.length > 0 ? (
							<fieldset className="flex flex-wrap gap-xs">
								<legend className="sr-only">Snapshot references</legend>
								{references.map((ref) => (
									<button
										key={ref}
										type="button"
										onClick={() => setPanel({ reference: ref })}
										className="rounded border border-border-default px-xs py-1 tr-code-text text-primary hover:bg-control-bg-hovered"
									>
										{ref}
									</button>
								))}
							</fieldset>
						) : null}
					</div>
				</section>
			</div>
		</div>
	);
}
