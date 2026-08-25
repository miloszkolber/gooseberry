import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SettingsSection, useAppStore } from "@/store";
import { ModelsSettings } from "./models-settings";
import { ProvidersSettings } from "./providers-settings";
import { SignetSettings } from "./signet-settings";

export function SettingsDialog() {
	const open = useAppStore((state) => state.settingsOpen);
	const section = useAppStore((state) => state.settingsSection);
	return (
		<Dialog open={open} onOpenChange={(next) => !next && useAppStore.getState().closeSettings()}>
			<DialogContent
				data-testid="settings-dialog"
				className="flex max-h-[88vh] w-full max-w-[64rem] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="border-border-default border-b px-lg py-md">
					<DialogTitle>Models and providers</DialogTitle>
				</DialogHeader>
				<nav
					className="flex gap-xs border-border-default border-b px-lg py-sm"
					aria-label="Settings"
				>
					<SettingsTab
						active={section === SettingsSection.Providers}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Providers)}
					>
						Providers
					</SettingsTab>
					<SettingsTab
						active={section === SettingsSection.Models}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Models)}
					>
						Models
					</SettingsTab>
					<SettingsTab
						active={section === SettingsSection.Signet}
						onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Signet)}
					>
						Signet
					</SettingsTab>
				</nav>
				<div className="min-h-0 flex-1 overflow-y-auto p-lg">
					{section === SettingsSection.Models ? (
						<ModelsSettings />
					) : section === SettingsSection.Signet ? (
						<SignetSettings />
					) : (
						<ProvidersSettings />
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function SettingsTab({
	active,
	children,
	onClick,
}: {
	active: boolean;
	children: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-current={active ? "page" : undefined}
			onClick={onClick}
			className={`rounded-[var(--radius-sm)] px-md py-xs tr-text-ui ${
				active
					? "bg-control-bg-selected text-text-default"
					: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			}`}
		>
			{children}
		</button>
	);
}
