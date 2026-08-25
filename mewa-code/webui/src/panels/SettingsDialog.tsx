import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAppStore } from "@/store";
import { ProvidersSettings } from "./ProvidersSettings";

export function SettingsDialog() {
	const open = useAppStore((state) => state.settingsOpen);
	return (
		<Dialog open={open} onOpenChange={(next) => !next && useAppStore.getState().closeSettings()}>
			<DialogContent
				data-testid="settings-dialog"
				className="flex max-h-[85vh] w-full max-w-[44rem] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="border-border-default border-b px-lg py-md">
					<DialogTitle>Provider authentication</DialogTitle>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-y-auto p-lg">
					<ProvidersSettings />
				</div>
			</DialogContent>
		</Dialog>
	);
}
