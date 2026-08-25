import { createHash } from "node:crypto";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { isStrongToken } from "@mewa-code/contracts";
import { type Static, Type } from "typebox";

export const BROWSER_MAX_ARGS = 64;
export const BROWSER_MAX_RESPONSE_BYTES = 1024 * 1024;
export const BROWSER_MAX_SCREENSHOT_BYTES = 64 * 1024 * 1024;
export const BROWSER_REQUEST_TIMEOUT_MS = 130_000;
export const BROWSER_ARTIFACT_TIMEOUT_MS = 30_000;

const ARTIFACT_PATH_PATTERN =
	/^\/v1\/artifacts\/[A-Za-z0-9_-]{1,38}\/[A-Za-z0-9][A-Za-z0-9._-]{0,126}\.(?:png|jpe?g|webp)$/i;

const commandSchema = Type.Union([
	Type.Literal("open"),
	Type.Literal("back"),
	Type.Literal("forward"),
	Type.Literal("reload"),
	Type.Literal("close"),
	Type.Literal("click"),
	Type.Literal("dblclick"),
	Type.Literal("fill"),
	Type.Literal("type"),
	Type.Literal("hover"),
	Type.Literal("focus"),
	Type.Literal("check"),
	Type.Literal("uncheck"),
	Type.Literal("select"),
	Type.Literal("press"),
	Type.Literal("scroll"),
	Type.Literal("scrollintoview"),
	Type.Literal("wait"),
	Type.Literal("read"),
	Type.Literal("snapshot"),
	Type.Literal("screenshot"),
	Type.Literal("get"),
	Type.Literal("is"),
	Type.Literal("set"),
	Type.Literal("a11y"),
	Type.Literal("vitals"),
]);

export const browserSchema = Type.Object({
	command: commandSchema,
	args: Type.Optional(
		Type.Array(Type.String(), {
			maxItems: BROWSER_MAX_ARGS,
			description:
				"Arguments for the selected bounded browser command. Use simple selectors, values, or the documented command-specific options.",
		}),
	),
	session: Type.Optional(
		Type.String({
			pattern: "^[A-Za-z0-9_-]{1,38}$",
			description: "Optional stable browser session name",
		}),
	),
});

export type BrowserCommand = Static<typeof commandSchema>;
export type BrowserParams = Static<typeof browserSchema>;

export interface BrowserArtifact {
	name: string;
	url: string;
}

export interface BrowserToolDetails {
	session: string;
	command: BrowserCommand;
	code?: string | number;
	artifact?: BrowserArtifact;
}

interface BrowserServicePayload {
	code?: unknown;
	stdout?: unknown;
	stderr?: unknown;
	warnings?: unknown;
	hints?: unknown;
	artifact?: unknown;
}

type BrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function defaultSession(cwd: string, sessionId?: string): string {
	// A repository can have several live Pi sessions. Keep their browser profiles
	// separate even when they share the same cwd, while including cwd so the same
	// Pi session resumed in another project does not inherit an unrelated profile.
	const identity = JSON.stringify({ cwd, sessionId: sessionId ?? "" });
	return `p${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

export function buildBrowserRequest(
	params: BrowserParams,
	cwd: string,
	sessionId?: string,
): {
	session: string;
	command: BrowserCommand;
	args: string[];
} {
	return {
		session: params.session ?? defaultSession(cwd, sessionId),
		command: params.command,
		args: params.args ?? [],
	};
}

function browserBaseUrl(): string {
	const configured = (process.env.MEWA_BROWSER_URL ?? "http://mewa-browser:8787").replace(
		/\/$/,
		"",
	);
	let url: URL;
	try {
		url = new URL(configured);
	} catch (error) {
		throw new Error("MEWA_BROWSER_URL must be an absolute http(s) URL", { cause: error });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("MEWA_BROWSER_URL must use http:// or https://");
	}
	if (url.username || url.password) {
		throw new Error("MEWA_BROWSER_URL must not contain embedded credentials");
	}
	return url.toString().replace(/\/$/, "");
}

function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function readJsonBounded(
	response: Response,
	maximum = BROWSER_MAX_RESPONSE_BYTES,
): Promise<unknown> {
	const length = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(length) && length > maximum) {
		throw new Error("mewa-browser response exceeded its maximum size");
	}
	const reader = response.body?.getReader();
	if (!reader) return {};
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maximum) {
			await reader.cancel();
			throw new Error("mewa-browser response exceeded its maximum size");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}

async function readBytesBounded(response: Response, maximum: number): Promise<Uint8Array> {
	const length = Number(response.headers.get("content-length") ?? "0");
	if (Number.isFinite(length) && length > maximum) {
		throw new Error("mewa-browser screenshot exceeded its maximum size");
	}
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maximum) {
			await reader.cancel();
			throw new Error("mewa-browser screenshot exceeded its maximum size");
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function codeOf(value: unknown): string | number | undefined {
	return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function payloadOf(value: unknown): BrowserServicePayload {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("mewa-browser returned an invalid JSON response");
	}
	return value as BrowserServicePayload;
}

function artifactOf(value: unknown): BrowserArtifact | undefined {
	if (!value || typeof value !== "object") return undefined;
	const name = Reflect.get(value, "name");
	const url = Reflect.get(value, "url");
	if (typeof name !== "string" || typeof url !== "string") return undefined;
	return { name, url };
}

function artifactAddress(baseUrl: string, path: string): { absolute: string; route: string } {
	const base = new URL(baseUrl);
	const url = new URL(path, `${base.origin}/`);
	if (
		url.origin !== base.origin ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		!ARTIFACT_PATH_PATTERN.test(url.pathname)
	) {
		throw new Error("mewa-browser returned an artifact URL from an unexpected origin or path");
	}
	return { absolute: url.toString(), route: url.pathname };
}

export async function executeBrowserRequest(
	params: BrowserParams,
	cwd: string,
	signal: AbortSignal | undefined,
	fetchImpl: BrowserFetch = fetch,
	sessionId?: string,
): Promise<AgentToolResult<BrowserToolDetails>> {
	const token = process.env.MEWA_BROWSER_TOKEN;
	if (!token) throw new Error("MEWA_BROWSER_TOKEN is not configured");
	if (!isStrongToken(token))
		throw new Error("MEWA_BROWSER_TOKEN must be at least 32 printable random-token characters");
	const baseUrl = browserBaseUrl();
	const request = buildBrowserRequest(params, cwd, sessionId);
	const response = await fetchImpl(`${baseUrl}/v1/browser`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
		redirect: "error",
		signal: boundedSignal(signal, BROWSER_REQUEST_TIMEOUT_MS),
	});
	const payload = payloadOf(await readJsonBounded(response));
	const code = codeOf(payload.code);
	if (!response.ok) {
		const details = [
			...strings(payload.warnings),
			...strings(payload.hints).map((hint) => `hint: ${hint}`),
		].join("\n");
		throw new Error(`mewa-browser ${code ?? response.status}: ${details || response.statusText}`);
	}

	const artifact = artifactOf(payload.artifact);
	if (payload.artifact !== undefined && payload.artifact !== null && !artifact) {
		throw new Error("mewa-browser returned an invalid artifact description");
	}
	const artifactLocation = artifact ? artifactAddress(baseUrl, artifact.url) : undefined;
	const text = [payload.stdout, payload.stderr]
		.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
		.join("\n");
	const content: AgentToolResult<BrowserToolDetails>["content"] = [
		{ type: "text", text: text || `${request.command} completed` },
	];

	if (artifact && artifactLocation) {
		const artifactResponse = await fetchImpl(artifactLocation.absolute, {
			headers: { authorization: `Bearer ${token}` },
			redirect: "error",
			signal: boundedSignal(signal, BROWSER_ARTIFACT_TIMEOUT_MS),
		});
		if (!artifactResponse.ok)
			throw new Error("mewa-browser could not retrieve screenshot artifact");
		const mimeType =
			artifactResponse.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
		if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) {
			throw new Error(
				`mewa-browser returned an unsupported screenshot type: ${mimeType || "missing"}`,
			);
		}
		const bytes = await readBytesBounded(artifactResponse, BROWSER_MAX_SCREENSHOT_BYTES);
		content.push({
			type: "image",
			data: Buffer.from(bytes).toString("base64"),
			mimeType,
		});
	}

	return {
		content,
		details: {
			session: request.session,
			command: request.command,
			...(code !== undefined ? { code } : {}),
			...(artifact && artifactLocation
				? { artifact: { ...artifact, url: artifactLocation.route } }
				: {}),
		},
	};
}

export function createBrowserTool(
	fetchImpl?: BrowserFetch,
): ToolDefinition<typeof browserSchema, BrowserToolDetails> {
	return {
		name: "browser",
		label: "browser",
		description:
			"Control the isolated visual-testing browser. Browser state is session-scoped, URLs are restricted to HTTP(S), and screenshots are retrieved as image results.",
		parameters: browserSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
			return executeBrowserRequest(
				params,
				ctx.cwd,
				signal,
				fetchImpl,
				ctx.sessionManager.getSessionId(),
			);
		},
	};
}

export function mewaBrowser(pi: ExtensionAPI): void {
	pi.registerTool(createBrowserTool());
}

export default mewaBrowser;
