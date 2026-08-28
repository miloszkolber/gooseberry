import type { ProviderAuthKind, ProviderStatus, ProviderStatusReport } from "@gooseberry/contracts";
import { Boxes, Check, KeyRound, Lock, LogIn, LogOut, RefreshCw, Search } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoginDialog } from "@/auth";
import { Button } from "@/components/ui/button";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

const KIND_LABEL: Record<ProviderAuthKind, string> = {
	oauth: "OAuth subscription",
	"api-key": "API key",
	env: "environment",
	other: "configured",
};

export function ProvidersSettings() {
	const [report, setReport] = useState<ProviderStatusReport | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [busyProvider, setBusyProvider] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const activeLogin = useAppStore((s) => s.activeLogin);
	const providerVersion = useAppStore((s) => s.providerVersion);
	const loadSequence = useRef(0);

	const load = useCallback(async () => {
		const sequence = ++loadSequence.current;
		const version = useAppStore.getState().providerVersion;
		const isCurrent = () =>
			sequence === loadSequence.current && version === useAppStore.getState().providerVersion;
		setRefreshing(true);
		try {
			const next = await getTransport().request("provider.status", {});
			if (!isCurrent()) return;
			setReport(next);
			setFailed(false);
		} catch {
			if (!isCurrent()) return;
			setFailed(true);
		} finally {
			if (sequence === loadSequence.current) setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (providerVersion > 0) void load();
	}, [providerVersion, load]);

	useEffect(() => {
		if (activeLogin?.status === "success") void load();
	}, [activeLogin?.status, load]);

	const startLogin = useCallback(async (providerId: string, type: "oauth" | "api_key") => {
		setBusyProvider(providerId);
		try {
			const { loginId } = await getTransport().request("provider.loginStart", { providerId, type });
			useAppStore.getState().beginLogin(loginId, providerId);
		} catch (err) {
			toast.error(errorText(err), "Couldn't start the connection");
		} finally {
			setBusyProvider(null);
		}
	}, []);

	const logout = useCallback(
		async (providerId: string) => {
			setBusyProvider(providerId);
			try {
				await getTransport().request("provider.logout", { providerId });
				useAppStore.getState().noteProviderChanged();
			} catch (err) {
				toast.error(errorText(err), "Couldn't sign out");
				return;
			} finally {
				setBusyProvider(null);
			}
			await load();
		},
		[load],
	);

	const providers = report?.providers ?? [];
	const filtered = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		if (!normalized) return providers;
		return providers.filter(
			(provider) =>
				provider.name.toLocaleLowerCase().includes(normalized) ||
				provider.id.toLocaleLowerCase().includes(normalized),
		);
	}, [providers, query]);
	const configured = filtered.filter((provider) => provider.configured);
	const unconfigured = filtered.filter((provider) => !provider.configured);
	const loginProviderName =
		providers.find((provider) => provider.id === activeLogin?.providerId)?.name ??
		activeLogin?.providerId ??
		"";
	const rowBusy = (id: string) => busyProvider === id || activeLogin !== null;

	return (
		<div data-testid="settings-providers" className="flex flex-col gap-lg">
			<div className="flex items-start justify-between gap-sm">
				<div className="flex flex-col gap-xs">
					<h3 className="tr-title-section text-text-default">Providers</h3>
					<p className="text-text-muted tr-text-metadata">
						Provider availability is reported by Goose. Configure credentials in Goose.
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					data-testid="providers-refresh"
					aria-label="Refresh provider status"
					title="Refresh"
					disabled={refreshing}
					onClick={() => void load()}
				>
					<RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</div>

			<label className="flex items-center gap-sm rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm">
				<Search className="size-4 shrink-0 text-text-muted" />
				<input
					data-testid="providers-filter"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Filter providers…"
					className="min-w-0 flex-1 bg-transparent text-text-default outline-none tr-text-ui placeholder:text-text-muted"
				/>
			</label>

			{report == null && !failed ? (
				<p className="text-text-muted tr-text-ui">Loading providers…</p>
			) : failed ? (
				<p data-testid="providers-error" className="text-text-muted tr-text-ui">
					Couldn't read provider status from the controller.
				</p>
			) : filtered.length === 0 ? (
				<p className="text-text-muted tr-text-ui">No providers match this filter.</p>
			) : (
				<>
					{configured.length > 0 ? (
						<Group title={`Connected (${configured.length})`}>
							{configured.map((provider) => (
								<ProviderCard
									key={provider.id}
									provider={provider}
									busy={rowBusy(provider.id)}
									onSignIn={(type) => void startLogin(provider.id, type)}
									onSignOut={() => void logout(provider.id)}
								/>
							))}
						</Group>
					) : null}
					{unconfigured.length > 0 ? (
						<Group title={`Available (${unconfigured.length})`}>
							{unconfigured.map((provider) => (
								<ProviderCard
									key={provider.id}
									provider={provider}
									busy={rowBusy(provider.id)}
									onSignIn={(type) => void startLogin(provider.id, type)}
									onSignOut={() => void logout(provider.id)}
								/>
							))}
						</Group>
					) : null}
				</>
			)}

			{activeLogin ? (
				<LoginDialog
					key={activeLogin.loginId}
					state={activeLogin}
					providerName={loginProviderName}
					onReply={(value) => {
						getTransport()
							.request("provider.loginReply", { loginId: activeLogin.loginId, value })
							.catch((err) => toast.error(errorText(err), "Couldn't submit"));
						useAppStore.getState().clearLoginInput();
					}}
					onCancel={() => {
						getTransport()
							.request("provider.loginCancel", { loginId: activeLogin.loginId })
							.catch(() => {});
						useAppStore.getState().clearLogin();
					}}
					onClose={() => {
						useAppStore.getState().clearLogin();
						useAppStore.getState().noteProviderChanged();
						void load();
					}}
				/>
			) : null}
		</div>
	);
}

function Group({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-sm">
			<h4 className="tr-text-eyebrow text-text-muted">{title}</h4>
			<div className="flex flex-col gap-xs">{children}</div>
		</section>
	);
}

function modelSummary(provider: ProviderStatus): string {
	if (provider.modelCount === 0) return "No catalogued models";
	if (!provider.configured)
		return `${provider.modelCount} model${provider.modelCount === 1 ? "" : "s"}`;
	return `${provider.availableModelCount} of ${provider.modelCount} models available`;
}

export function ProviderCard({
	provider,
	busy,
	onSignIn,
	onSignOut,
}: {
	provider: ProviderStatus;
	busy: boolean;
	onSignIn: (type: "oauth" | "api_key") => void;
	onSignOut: () => void;
}) {
	const configuredLabel = provider.kind ? KIND_LABEL[provider.kind] : "configured";
	return (
		<div
			data-testid="provider-row"
			data-provider={provider.id}
			data-configured={String(provider.configured)}
			className="flex items-center gap-md rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-md py-sm"
		>
			<span
				className={`flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] ${
					provider.configured
						? "bg-feedback-success-subtle text-feedback-success"
						: "bg-control-bg-selected text-text-muted"
				}`}
			>
				{provider.configured ? <Check className="size-4" /> : <Boxes className="size-4" />}
			</span>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="truncate tr-text-ui text-text-default">{provider.name}</span>
				<span className="truncate text-text-muted tr-text-metadata">
					{provider.id} · {modelSummary(provider)}
				</span>
				{provider.configured ? (
					<span className="truncate text-text-muted tr-text-metadata">
						{configuredLabel}
						{provider.detail ? ` · ${provider.detail}` : ""}
					</span>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-xs">
				{provider.configured && provider.canLogout ? (
					<Button
						variant="outline"
						size="sm"
						data-testid="provider-signout"
						data-provider={provider.id}
						disabled={busy}
						onClick={onSignOut}
					>
						<LogOut className="size-3.5" />
						Sign out
					</Button>
				) : null}
				{!provider.configured && provider.canApiKey ? (
					<Button
						variant={provider.canOAuth ? "outline" : "default"}
						size="sm"
						data-testid="provider-apikey"
						data-provider={provider.id}
						disabled={busy}
						onClick={() => onSignIn("api_key")}
					>
						<KeyRound className="size-3.5" />
						API key
					</Button>
				) : null}
				{!provider.configured && provider.canOAuth ? (
					<Button
						variant="default"
						size="sm"
						data-testid="provider-signin"
						data-provider={provider.id}
						disabled={busy}
						onClick={() => onSignIn("oauth")}
					>
						<LogIn className="size-3.5" />
						Sign in
					</Button>
				) : null}
				{(provider.configured && !provider.canLogout) ||
				(!provider.configured && !provider.canApiKey && !provider.canOAuth) ? (
					<span
						className="flex shrink-0 items-center gap-xs text-text-muted tr-text-metadata"
						title="Configured through Goose or its environment"
					>
						<Lock className="size-3" />
						Managed by Goose
					</span>
				) : null}
			</div>
		</div>
	);
}
