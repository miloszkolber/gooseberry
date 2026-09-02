import type { ImageContent } from "@gooseberry/contracts";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { FileChip } from "./file-chip";

export function ImageChip({ label, image }: { label: string; image: ImageContent }) {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<FileChip
					data-testid="chat-attachment-chip"
					title={label}
					aria-label={`View attachment ${label}`}
					label={label}
				/>
			</DialogTrigger>
			<DialogContent
				data-testid="chat-attachment-dialog"
				className="flex max-h-[90vh] w-max max-w-[95vw] flex-col gap-sm"
			>
				<DialogHeader>
					<DialogTitle>{label}</DialogTitle>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-auto">
					<img
						src={`data:${image.mimeType};base64,${image.data}`}
						alt=""
						className="max-h-[80vh] max-w-full rounded-[var(--radius-sm)]"
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
