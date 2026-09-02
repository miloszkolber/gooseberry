import { Pencil } from "lucide-react";
import { projectRelativePath } from "@/lib";
import type { ToolRenderProps } from "../render/tool-registry";
import { Collapsible } from "./collapsible";
import { resultText, strArg } from "./tool-helpers";
import { ToolOutput } from "./tool-output";

export function EditCard({ args, result, status, projectAreaRoot }: ToolRenderProps) {
	const path = strArg(args, "path");
	const oldText =
		strArg(args, "before") ||
		strArg(args, "oldText") ||
		strArg(args, "old_string") ||
		strArg(args, "old");
	const newText =
		strArg(args, "after") ||
		strArg(args, "newText") ||
		strArg(args, "new_string") ||
		strArg(args, "new");
	const message = resultText(result, status === "error");

	if (status === "error") {
		return (
			<div data-testid="tool-edit" className="flex flex-col gap-xs">
				<EditHeader path={path} projectAreaRoot={projectAreaRoot} status={status} />
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">{message}</pre>
			</div>
		);
	}

	const oldLines = oldText ? oldText.split("\n") : [];
	const newLines = newText ? newText.split("\n") : [];

	return (
		<div data-testid="tool-edit" className="flex flex-col gap-xs">
			<EditHeader path={path} projectAreaRoot={projectAreaRoot} status={status} />
			<Collapsible
				lines={oldLines.length + newLines.length}
				fadeClass="bg-[linear-gradient(to_top,var(--container-elevated-bg),transparent)]"
			>
				<div className="overflow-auto rounded-[var(--radius-sm)] border border-border-default tr-code-text leading-relaxed">
					{oldLines.map((line, i) => {
						const key = `old-${i}`;
						return (
							<div key={key} className="flex bg-feedback-error-subtle">
								<span className="w-6 shrink-0 select-none px-1 text-right text-feedback-error-muted">
									−
								</span>
								<pre className="min-w-0 flex-1 px-1 text-feedback-error tr-code-text">{line}</pre>
							</div>
						);
					})}
					{newLines.map((line, i) => {
						const key = `new-${i}`;
						return (
							<div key={key} className="flex bg-feedback-success-subtle">
								<span className="w-6 shrink-0 select-none px-1 text-right text-feedback-success-muted">
									+
								</span>
								<pre className="min-w-0 flex-1 px-1 text-feedback-success tr-code-text">{line}</pre>
							</div>
						);
					})}
				</div>
			</Collapsible>
			<ToolOutput result={result} />
		</div>
	);
}

function EditHeader({
	path,
	projectAreaRoot,
	status,
}: {
	path: string;
	projectAreaRoot?: string | undefined;
	status: ToolRenderProps["status"];
}) {
	const displayPath = projectRelativePath(path, projectAreaRoot);
	return (
		<div className="flex items-center gap-xs tr-text-metadata">
			<Pencil className="size-3.5 shrink-0 text-feedback-warning" />
			<span className="truncate text-text-default" title={path}>
				{displayPath}
			</span>
			<span className="shrink-0 text-text-muted">
				{status === "running" ? "editing…" : status === "error" ? "edit failed" : "edited"}
			</span>
		</div>
	);
}
