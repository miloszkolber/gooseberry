import { Camera, Globe } from "lucide-react";
import type { ToolRenderProps } from "../../tool-registry";
import { Collapsible, countLines } from "../collapsible";
import { resultText, strArg, toolContent } from "../tool-helpers";

const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil((64 * 1024 * 1024) / 3) * 4;
const ARTIFACT_PATH_PATTERN =
	/^\/v1\/artifacts\/[A-Za-z0-9_-]{1,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.(?:png|jpe?g|webp)$/i;

export interface BrowserImageBlock {
	type: "image";
	data: string;
	mimeType: string;
}

export interface BrowserArtifact {
	name: string;
	url?: string;
}

export interface BrowserDetails {
	session?: string;
	command?: string;
	code?: string | number;
	artifact?: BrowserArtifact;
}

function browserResponse(result: unknown): Record<string, unknown> | undefined {
	const response = (value: unknown): Record<string, unknown> | undefined => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
		const outcome = Reflect.get(value, "outcome");
		return outcome === "completed" || outcome === "failed" || outcome === "rejected"
			? (value as Record<string, unknown>)
			: undefined;
	};
	const direct = response(result);
	if (direct) return direct;
	if (result && typeof result === "object") {
		const structured = response(Reflect.get(result, "structuredContent"));
		if (structured) return structured;
	}
	// Goose may retain MCP's text fallback instead of its structured payload.
	const texts = toolContent(result);
	for (const block of texts) {
		const text =
			typeof block === "string"
				? block
				: block && typeof block === "object" && Reflect.get(block, "type") === "text"
					? Reflect.get(block, "text")
					: undefined;
		if (typeof text !== "string" || text.length > 1024 * 1024) continue;
		try {
			const parsed = response(JSON.parse(text));
			if (parsed) return parsed;
		} catch {
			// Ordinary browser output remains plain text.
		}
	}
	return undefined;
}

export function browserDetails(result: unknown): BrowserDetails {
	const raw =
		(result && typeof result === "object" ? Reflect.get(result, "details") : undefined) ??
		browserResponse(result);
	if (!raw || typeof raw !== "object") return {};
	const session = Reflect.get(raw, "session");
	const command = Reflect.get(raw, "command");
	const code = Reflect.get(raw, "code");
	const rawArtifact = Reflect.get(raw, "artifact");
	const artifact =
		typeof rawArtifact === "string"
			? { name: rawArtifact }
			: rawArtifact &&
					typeof rawArtifact === "object" &&
					typeof Reflect.get(rawArtifact, "name") === "string"
				? {
						name: Reflect.get(rawArtifact, "name") as string,
						...(typeof Reflect.get(rawArtifact, "url") === "string"
							? { url: Reflect.get(rawArtifact, "url") as string }
							: {}),
					}
				: undefined;
	return {
		...(typeof session === "string" ? { session } : {}),
		...(typeof command === "string" ? { command } : {}),
		...(typeof code === "string" || typeof code === "number" ? { code } : {}),
		...(artifact ? { artifact } : {}),
	};
}

function isBrowserImageBlock(value: unknown): value is BrowserImageBlock {
	if (!value || typeof value !== "object") return false;
	const data = Reflect.get(value, "data");
	const mimeType = Reflect.get(value, "mimeType");
	return (
		Reflect.get(value, "type") === "image" &&
		typeof data === "string" &&
		typeof mimeType === "string" &&
		data.length > 0 &&
		data.length <= MAX_IMAGE_BASE64_LENGTH &&
		IMAGE_MIME_TYPES.has(mimeType.toLowerCase()) &&
		BASE64_PATTERN.test(data)
	);
}

export function browserImages(result: unknown): BrowserImageBlock[] {
	return toolContent(result).filter(isBrowserImageBlock);
}

export function browserArtifactUrl(url: string | undefined): string | undefined {
	if (!url || url.includes("\\") || url.includes("?") || url.includes("#")) return undefined;
	return ARTIFACT_PATH_PATTERN.test(url) ? url : undefined;
}

function BrowserImage({ image, command }: { image: BrowserImageBlock; command: string }) {
	const mimeType = image.mimeType.toLowerCase();
	return (
		<img
			src={`data:${mimeType};base64,${image.data}`}
			alt={`${command} screenshot`}
			loading="lazy"
			decoding="async"
			className="max-h-[28rem] max-w-full rounded-[var(--radius-sm)] border border-border-default object-contain"
		/>
	);
}

export function BrowserCard({ args, result, status }: ToolRenderProps) {
	const response = browserResponse(result);
	const details = browserDetails(response ?? result);
	const command = details.command || strArg(args, "command") || "browser";
	const session = details.session ?? strArg(args, "session");
	const output = response
		? [
				response.stdout,
				response.stderr,
				response.message,
				response.hint,
				...(Array.isArray(response.warnings) ? response.warnings : []),
				...(Array.isArray(response.hints) ? response.hints : []),
			]
				.filter((value): value is string => typeof value === "string" && value.length > 0)
				.join("\n")
		: resultText(result, status === "error");
	const failed =
		status === "error" || response?.outcome === "failed" || response?.outcome === "rejected";
	const images = browserImages(result);
	const artifact = details.artifact;
	const artifactHref = browserArtifactUrl(artifact?.url);

	return (
		<div data-testid="tool-browser" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs tr-text-metadata">
				<Globe className="size-3.5 shrink-0 text-text-muted" />
				<span className="text-primary">{command}</span>
				{session ? <span className="truncate text-text-muted">in {session}</span> : null}
			</div>
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">Running browser command…</span>
			) : failed ? (
				<pre className="overflow-auto px-sm py-xs text-feedback-error tr-code-text">
					{output || (typeof details.code === "string" ? details.code : "Browser command failed.")}
				</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-header-bg p-sm tr-code-text text-text-default">
						{output}
					</pre>
				</Collapsible>
			) : null}
			{artifact ? (
				<div
					data-testid="tool-browser-artifact"
					className="flex items-center gap-xs text-text-muted tr-text-metadata"
				>
					<Camera className="size-3.5 shrink-0" />
					<span>Artifact:</span>
					{artifactHref ? (
						<a
							href={artifactHref}
							target="_blank"
							rel="noreferrer"
							className="truncate text-primary hover:underline"
						>
							{artifact.name}
						</a>
					) : (
						<span className="truncate">{artifact.name}</span>
					)}
				</div>
			) : null}
			{images.length > 0 ? (
				<div data-testid="tool-browser-images" className="flex flex-wrap gap-sm">
					{(() => {
						const keyCounts = new Map<string, number>();
						return images.map((image) => {
							const base = `${image.mimeType}-${image.data.length}-${image.data.slice(0, 32)}`;
							const count = keyCounts.get(base) ?? 0;
							keyCounts.set(base, count + 1);
							return <BrowserImage key={`${base}-${count}`} image={image} command={command} />;
						});
					})()}
				</div>
			) : null}
			{status === "done" && !failed && !output && !artifact && images.length === 0 ? (
				<span className="text-text-muted tr-text-metadata italic">No browser output.</span>
			) : null}
		</div>
	);
}
