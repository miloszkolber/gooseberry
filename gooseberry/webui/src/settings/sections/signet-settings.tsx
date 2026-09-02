import type { SignetStatus } from "@gooseberry/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";
import { errorText, getTransport } from "../../connection";

export function SignetSettings() {
	const config = useAppStore((state) => state.config);
	const [enabled, setEnabled] = useState(config.signet.enabled);
	const [address, setAddress] = useState(config.signet.address);
	const [port, setPort] = useState(String(config.signet.port));
	const [status, setStatus] = useState<SignetStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const refresh = () => {
		void getTransport()
			.request("signet.status", {})
			.then(setStatus)
			.catch(() => setStatus(null));
	};
	useEffect(refresh, []);

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const numericPort = Number(port);
			if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
				throw new Error("Port must be between 1 and 65535.");
			}
			const next = await getTransport().request("settings.update", {
				config: { signet: { enabled, address, port: numericPort } },
			});
			useAppStore.getState().applyConfig(next);
			refresh();
		} catch (failure) {
			setError(errorText(failure));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="mx-auto flex w-full max-w-[36rem] flex-col gap-lg">
			<div>
				<h2 className="tr-title-entity text-text-default">Signet memory</h2>
				<p className="mt-xs tr-text-ui text-text-muted">
					Optional durable memory for agent sessions.
				</p>
			</div>
			<label className="flex items-center justify-between gap-md rounded-[var(--radius-sm)] border border-border-default p-md">
				<span className="tr-text-ui text-text-default">Enable Signet</span>
				<input
					type="checkbox"
					checked={enabled}
					onChange={(event) => setEnabled(event.target.checked)}
				/>
			</label>
			<div className="grid min-w-0 grid-cols-1 gap-sm sm:grid-cols-[minmax(0,1fr)_8rem]">
				<label className="flex flex-col gap-xs tr-text-metadata text-text-muted">
					Address
					<input
						value={address}
						onChange={(event) => setAddress(event.target.value)}
						disabled={!enabled}
						className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default"
					/>
				</label>
				<label className="flex flex-col gap-xs tr-text-metadata text-text-muted">
					Port
					<input
						type="number"
						min={1}
						max={65535}
						value={port}
						onChange={(event) => setPort(event.target.value)}
						disabled={!enabled}
						className="rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs tr-text-ui text-text-default"
					/>
				</label>
			</div>
			<div className="flex items-center justify-between gap-md">
				<span
					className={`tr-text-metadata ${status?.reachable ? "text-feedback-success" : "text-text-muted"}`}
				>
					{!status?.enabled
						? "Disabled"
						: status.reachable
							? `Connected to ${status.endpoint}`
							: `Unavailable at ${status.endpoint}`}
				</span>
				<Button onClick={() => void save()} disabled={saving || !address.trim()}>
					{saving ? "Saving…" : "Save"}
				</Button>
			</div>
			{error ? (
				<p role="alert" className="tr-text-metadata text-feedback-error">
					{error}
				</p>
			) : null}
		</div>
	);
}
