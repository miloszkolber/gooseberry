import {
	KeyRound,
	type LucideIcon,
	Palette,
	PlugZap,
	SlidersHorizontal,
	SquareTerminal,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib";
import { SettingsSection, useAppStore } from "@/store";
import { AppearanceSettings } from "./AppearanceSettings";
import { PiProfileSettings } from "./PiProfileSettings";
import { ProvidersSettings } from "./ProvidersSettings";
import { TerminalSettings } from "./TerminalSettings";

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
	{ id: SettingsSection.Providers, label: "Providers", icon: KeyRound },
	{ id: SettingsSection.Extensions, label: "Pi profile", icon: PlugZap },
	{ id: SettingsSection.Appearance, label: "Appearance", icon: Palette },
	{ id: SettingsSection.Terminal, label: "Terminal", icon: SquareTerminal },
];
const SOON: { label: string; icon: LucideIcon }[] = [{ label: "General", icon: SlidersHorizontal }];

export function SettingsDialog() {
	const open = useAppStore((s) => s.settingsOpen);
	const section = useAppStore((s) => s.settingsSection);

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) useAppStore.getState().closeSettings();
			}}
		>
			<DialogContent
				data-testid="settings-dialog"
				className="flex h-[80vh] max-h-[85vh] w-full max-w-[52rem] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="border-border-default border-b px-lg py-md">
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col md:flex-row">
					<nav
						aria-label="Settings sections"
						className="flex shrink-0 gap-xs overflow-x-auto border-border-default border-b p-sm md:w-[192px] md:flex-col md:gap-0.5 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:bg-container-elevated-bg md:p-md"
					>
						{SECTIONS.map(({ id, label, icon: Icon }) => {
							const active = section === id;
							return (
								<button
									key={id}
									type="button"
									data-testid={`settings-nav-${id}`}
									data-active={active}
									onClick={() => useAppStore.getState().setSettingsSection(id)}
									className={cn(
										"flex shrink-0 items-center gap-sm rounded-[var(--radius-sm)] px-md py-sm text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
										active
											? "bg-primary-subtle text-primary"
											: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
									)}
								>
									<Icon className="size-4 shrink-0" />
									{label}
								</button>
							);
						})}
						{SOON.map(({ label, icon: Icon }) => (
							<span
								key={label}
								className="flex shrink-0 cursor-default items-center gap-sm rounded-[var(--radius-sm)] px-md py-sm text-text-disabled tr-text-ui"
							>
								<Icon className="size-4 shrink-0" />
								{label}
								<span className="ml-auto rounded-full border border-border-default px-xs py-0.5 tr-text-label-pill text-text-disabled">
									Soon
								</span>
							</span>
						))}
					</nav>

					<div className="min-h-0 flex-1 overflow-y-auto p-lg">
						{section === SettingsSection.Providers ? (
							<ProvidersSettings />
						) : section === SettingsSection.Extensions ? (
							<PiProfileSettings />
						) : section === SettingsSection.Terminal ? (
							<TerminalSettings />
						) : (
							<AppearanceSettings />
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
