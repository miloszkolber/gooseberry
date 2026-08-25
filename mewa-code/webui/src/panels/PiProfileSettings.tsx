import type { PiProfileCapability, PiProfileCapabilityId } from "@mewa-code/contracts";
import { Check, Lock, RefreshCw, ShieldCheck, ToggleLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

const TOGGLEABLE = new Set<PiProfileCapabilityId>([
	"browser",
	"webAccess",
	"signetMemory",
	"goals",
	"subagents",
]);

export function PiProfileSettings() {
	const profile = useAppStore((s) => s.piProfile);
	const [loading, setLoading] = useState(profile === null);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState<PiProfileCapabilityId | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const next = await getTransport().request("settings.profile", {});
			useAppStore.getState().applyPiProfile(next);
			setFailed(false);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (profile === null) void load();
	}, [load, profile]);

	const toggle = async (capability: PiProfileCapability) => {
		if (!TOGGLEABLE.has(capability.id) || !capability.available || busy !== null) return;
		setBusy(capability.id);
		try {
			await getTransport().request("settings.update", {
				config: { piProfile: { [capability.id]: !capability.enabled } },
			});
			await load();
		} catch (error) {
			toast.error(errorText(error), "Couldn't update the Pi profile");
		} finally {
			setBusy(null);
		}
	};

	return (
		<section data-testid="settings-pi-profile" className="flex flex-col gap-lg">
			<div className="flex items-start justify-between gap-sm">
				<div className="flex flex-col gap-xs">
					<h3 className="tr-title-section text-text-default">Mewa Pi profile</h3>
					<p className="text-text-muted tr-text-metadata">
						These are the curated Pi extensions Mewa exposes. Pi user and project extensions remain
						available separately.
					</p>
					<p className="text-text-muted tr-text-metadata">
						Changes apply to new sessions. Reload resources from a chat&apos;s Skills dialog to
						apply them to an existing session.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					data-testid="pi-profile-refresh"
					aria-label="Refresh Mewa Pi profile"
					disabled={loading}
					onClick={() => void load()}
				>
					<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			{loading && profile === null ? (
				<p className="text-text-muted tr-text-ui">Loading profile…</p>
			) : failed && profile === null ? (
				<p data-testid="pi-profile-error" className="text-text-muted tr-text-ui">
					Couldn&apos;t read the Pi profile from the host — try Refresh.
				</p>
			) : profile ? (
				<div className="flex flex-col gap-xs">
					{profile.capabilities.map((capability) => (
						<CapabilityRow
							key={capability.id}
							capability={capability}
							busy={busy === capability.id}
							onToggle={() => void toggle(capability)}
						/>
					))}
				</div>
			) : null}
		</section>
	);
}

function CapabilityRow({
	capability,
	busy,
	onToggle,
}: {
	capability: PiProfileCapability;
	busy: boolean;
	onToggle: () => void;
}) {
	const toggleable = TOGGLEABLE.has(capability.id);
	const status = !capability.available
		? `Unavailable${capability.unavailableReason ? `: ${capability.unavailableReason}` : ""}`
		: capability.required
			? "Always on"
			: capability.enabled
				? "Enabled"
				: "Disabled";
	return (
		<div
			data-testid={`pi-profile-row-${capability.id}`}
			data-available={capability.available}
			data-enabled={capability.enabled}
			className="flex items-center gap-md rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm"
		>
			<span
				className={`flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${
					!capability.available
						? "bg-control-bg-selected text-text-disabled"
						: capability.required || capability.enabled
							? "bg-feedback-success-subtle text-feedback-success"
							: "bg-control-bg-selected text-text-muted"
				}`}
			>
				{capability.required ? (
					<ShieldCheck className="size-4" />
				) : (
					<ToggleLeft className="size-4" />
				)}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-xs tr-text-ui">
					<span className="truncate text-text-default">{capability.label}</span>
					<span className="shrink-0 text-text-muted tr-text-metadata">{status}</span>
				</div>
				<p className="text-text-muted tr-text-metadata">{capability.description}</p>
			</div>
			{capability.required ? (
				<span className="flex shrink-0 items-center gap-xs text-text-muted tr-text-metadata">
					<Lock className="size-3" />
					Required
				</span>
			) : toggleable ? (
				<button
					type="button"
					role="switch"
					aria-checked={capability.enabled}
					aria-label={`${capability.enabled ? "Disable" : "Enable"} ${capability.label}`}
					data-testid={`pi-profile-toggle-${capability.id}`}
					disabled={!capability.available || busy}
					onClick={onToggle}
					className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-xs text-text-muted tr-text-ui outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
				>
					{capability.enabled ? <Check className="size-4 text-feedback-success" /> : null}
					{capability.enabled ? "On" : "Off"}
				</button>
			) : null}
		</div>
	);
}
