import type {
	RuntimeAgentStatus,
	RuntimeAvailability,
	RuntimeRequestMetrics,
	RuntimeServiceStatus,
	RuntimeStatusReport,
} from "@gooseberry/contracts";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";
import { getTransport } from "../connection";

const STATE_LABEL: Record<RuntimeAvailability, string> = {
	ready: "Ready",
	degraded: "Degraded",
	unavailable: "Unavailable",
};

const STATE_CLASS: Record<RuntimeAvailability, string> = {
	ready: "text-feedback-success",
	degraded: "text-feedback-warning",
	unavailable: "text-feedback-error",
};

function finiteNonnegative(value: number): number | null {
	return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatCount(value: number): string {
	const safe = finiteNonnegative(value);
	return safe === null ? "—" : Math.round(safe).toLocaleString();
}

function formatMilliseconds(value: number): string {
	const safe = finiteNonnegative(value);
	if (safe === null) return "—";
	if (safe < 0.1) return "<0.1 ms";
	if (safe < 1_000) return `${safe < 10 ? safe.toFixed(1) : Math.round(safe)} ms`;
	return `${(safe / 1_000).toFixed(safe < 10_000 ? 1 : 0)} s`;
}

function formatBytes(value: number): string {
	const safe = finiteNonnegative(value);
	if (safe === null) return "—";
	if (safe < 1_024) return `${Math.round(safe)} B`;
	if (safe < 1_024 * 1_024) return `${Math.round(safe / 1_024)} KiB`;
	return `${(safe / (1_024 * 1_024)).toFixed(safe < 10 * 1_024 * 1_024 ? 1 : 0)} MiB`;
}

function formatUptime(value: number): string {
	const safe = finiteNonnegative(value);
	if (safe === null) return "—";
	const seconds = Math.floor(safe);
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

function StatusBadge({ state }: { state: RuntimeAvailability }) {
	return (
		<span className={`inline-flex items-center gap-xs tr-text-metadata ${STATE_CLASS[state]}`}>
			<span
				aria-hidden="true"
				className={`size-1.5 rounded-full ${
					state === "ready"
						? "bg-feedback-success"
						: state === "degraded"
							? "bg-feedback-warning"
							: "bg-feedback-error"
				}`}
			/>
			{STATE_LABEL[state]}
		</span>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-sm py-xs">
			<dt className="text-text-muted tr-text-metadata">{label}</dt>
			<dd className="min-w-0 break-words text-right tabular-nums text-text-default tr-text-metadata">
				{value}
			</dd>
		</div>
	);
}

function RequestMetrics({ requests }: { requests: RuntimeRequestMetrics }) {
	return (
		<>
			<Metric label="Requests" value={formatCount(requests.total)} />
			<Metric label="Failures" value={formatCount(requests.failures)} />
			<Metric label="Active" value={formatCount(requests.active)} />
			<Metric label="Average" value={formatMilliseconds(requests.averageMs)} />
			<Metric label="Maximum" value={formatMilliseconds(requests.maxMs)} />
		</>
	);
}

function ServiceCard({
	name,
	status,
}: {
	name: "Application" | "Browser";
	status: RuntimeServiceStatus;
}) {
	return (
		<section
			data-testid={`system-card-${name.toLowerCase()}`}
			className="min-w-0 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-md"
		>
			<div className="flex items-center justify-between gap-sm">
				<h3 className="tr-text-ui text-text-default">{name}</h3>
				<StatusBadge state={status.state} />
			</div>
			{status.detail ? (
				<p className="mt-sm break-words text-text-muted tr-text-metadata">{status.detail}</p>
			) : null}
			{status.build || status.process || status.requests ? (
				<dl className="mt-sm divide-y divide-border-muted border-border-muted border-t">
					{status.build ? <Metric label="Version" value={status.build.version} /> : null}
					{status.build?.revision ? (
						<div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] gap-sm py-xs">
							<dt className="text-text-muted tr-text-metadata">Revision</dt>
							<dd className="min-w-0 text-right tr-text-metadata">
								<code className="break-all" title={status.build.revision}>
									{status.build.revision.slice(0, 12)}
								</code>
							</dd>
						</div>
					) : null}
					{status.process ? (
						<>
							<Metric label="Uptime" value={formatUptime(status.process.uptimeSeconds)} />
							<Metric label="Memory" value={formatBytes(status.process.heapBytes)} />
							<Metric label="Goroutines" value={formatCount(status.process.goroutines)} />
							<Metric label="GC cycles" value={formatCount(status.process.gcCycles)} />
						</>
					) : null}
					{status.requests ? <RequestMetrics requests={status.requests} /> : null}
				</dl>
			) : null}
		</section>
	);
}

function AgentCard({ status }: { status: RuntimeAgentStatus }) {
	return (
		<section
			data-testid="system-card-agent"
			className="min-w-0 rounded-[var(--radius-sm)] border border-border-default bg-control-bg p-md"
		>
			<div className="flex items-center justify-between gap-sm">
				<h3 className="tr-text-ui text-text-default">Agent</h3>
				<StatusBadge state={status.state} />
			</div>
			{status.detail ? (
				<p className="mt-sm break-words text-text-muted tr-text-metadata">{status.detail}</p>
			) : null}
			{status.name || status.version ? (
				<dl className="mt-sm divide-y divide-border-muted border-border-muted border-t">
					{status.name ? <Metric label="Name" value={status.name} /> : null}
					{status.version ? <Metric label="Version" value={status.version} /> : null}
				</dl>
			) : null}
		</section>
	);
}

export function SystemStatusReportView({ report }: { report: RuntimeStatusReport }) {
	return (
		<div className="grid min-w-0 grid-cols-1 gap-sm md:grid-cols-3">
			<ServiceCard name="Application" status={report.application} />
			<AgentCard status={report.agent} />
			<ServiceCard name="Browser" status={report.browser} />
		</div>
	);
}

export function SystemSettings() {
	const connected = useAppStore((state) => state.status === "connected");
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const [report, setReport] = useState<RuntimeStatusReport | null>(null);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const activeRequest = useRef<AbortController | null>(null);

	const load = useCallback(async () => {
		if (!connected) return;
		const generation = connectionGeneration;
		activeRequest.current?.abort();
		const request = new AbortController();
		activeRequest.current = request;
		setLoading(true);
		setFailed(false);
		try {
			const next = await getTransport().request(
				"runtime.status",
				{},
				{
					signal: request.signal,
					timeoutMs: 5_000,
				},
			);
			if (!request.signal.aborted && useAppStore.getState().connectionGeneration === generation) {
				setReport(next);
			}
		} catch {
			if (!request.signal.aborted && useAppStore.getState().connectionGeneration === generation) {
				setFailed(true);
			}
		} finally {
			if (activeRequest.current === request) {
				activeRequest.current = null;
				setLoading(false);
			}
		}
	}, [connected, connectionGeneration]);

	useEffect(() => {
		if (!connected) {
			activeRequest.current?.abort();
			activeRequest.current = null;
			setLoading(false);
			return;
		}
		void load();
		return () => {
			const request = activeRequest.current;
			activeRequest.current = null;
			request?.abort();
		};
	}, [connected, load]);

	const unavailable = !connected || failed;
	return (
		<div
			data-testid="system-settings"
			className="mx-auto flex w-full max-w-[56rem] flex-col gap-lg"
		>
			<div className="flex items-start justify-between gap-sm">
				<div className="min-w-0">
					<h2 className="tr-title-entity text-text-default">System</h2>
					<p className="mt-xs text-text-muted tr-text-metadata">
						Local services and build details.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					data-testid="system-refresh"
					disabled={!connected || loading}
					onClick={() => void load()}
				>
					<RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
					{loading ? "Refreshing…" : "Refresh"}
				</Button>
			</div>

			{unavailable ? (
				<p role="alert" className="text-feedback-error tr-text-metadata">
					{!connected
						? report
							? "Controller disconnected. Showing the last status."
							: "Controller disconnected."
						: report
							? "Couldn't refresh system status. Showing the last status."
							: "Couldn't read system status."}
				</p>
			) : loading ? (
				<p role="status" aria-live="polite" className="text-text-muted tr-text-metadata">
					{report ? "Refreshing system status…" : "Loading system status…"}
				</p>
			) : null}

			{report ? <SystemStatusReportView report={report} /> : null}
		</div>
	);
}
