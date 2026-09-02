import { ACCEPTED_IMAGE_TYPES } from "@gooseberry/contracts";
import { ImageChip } from "../composer/image-chip";
import { toolContent, toText } from "./tool-helpers";

export function ToolOutput({ result, error = false }: { result: unknown; error?: boolean }) {
	const blocks = toolContent(result, error);
	if (blocks.length === 0) return null;
	return (
		<div className="flex flex-col gap-xs" data-testid="tool-output">
			{blocks.map((block, index) => {
				// Output blocks retain their position across streaming snapshots.
				const key = `content-${index}`;
				const record = block && typeof block === "object" ? block : undefined;
				const type = record && Reflect.get(record, "type");
				if (type === "image" && record) {
					const data = Reflect.get(record, "data");
					const mimeType = Reflect.get(record, "mimeType");
					if (
						typeof data === "string" &&
						typeof mimeType === "string" &&
						ACCEPTED_IMAGE_TYPES.includes(mimeType)
					) {
						return (
							<ImageChip key={key} label={mimeType} image={{ type: "image", data, mimeType }} />
						);
					}
				}
				const text = type === "text" && record ? Reflect.get(record, "text") : undefined;
				const resource =
					type === "resource" && record ? Reflect.get(record, "resource") : undefined;
				// Embedded HTML is source text, never an executable document or iframe.
				const resourceText =
					resource && typeof resource === "object" ? Reflect.get(resource, "text") : undefined;
				return (
					<pre
						key={key}
						className={`overflow-auto tr-code-text ${error ? "text-feedback-error" : "text-text-default"}`}
					>
						{typeof text === "string"
							? text
							: typeof resourceText === "string"
								? `${String(Reflect.get(resource, "uri") ?? "")}\n${resourceText}`
								: toText(block)}
					</pre>
				);
			})}
		</div>
	);
}
