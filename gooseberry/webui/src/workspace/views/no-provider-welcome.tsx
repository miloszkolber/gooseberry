import type { ProviderStatusReport } from "@gooseberry/contracts";
import type { MouseEvent } from "react";
import { Button } from "../../components/ui/button";
import { openSettingsFrom } from "../../settings/open-settings";
import { useAppStore } from "../../store";

export function hasConfiguredProvider(report: ProviderStatusReport): boolean {
	return report.providers.some((provider) => provider.configured);
}

export function openProviderSettings(event?: MouseEvent<HTMLButtonElement>): void {
	if (event) {
		openSettingsFrom(event.currentTarget, "providers");
		return;
	}
	useAppStore.getState().openSettings("providers");
}

export function NoProviderWelcome() {
	return (
		<main
			data-testid="no-provider-welcome"
			className="flex h-full min-h-0 min-w-0 flex-col items-center justify-center gap-md bg-container-content-bg px-xl py-xl text-center"
		>
			<h1 className="tr-brand-hero text-primary">Goose unavailable</h1>
			<p className="max-w-[34rem] tr-text-reading text-text-muted">
				Start Goose ACP and configure a provider in Goose, then refresh this page.
			</p>
			<Button data-testid="connect-provider" onClick={openProviderSettings}>
				View Goose providers
			</Button>
		</main>
	);
}
