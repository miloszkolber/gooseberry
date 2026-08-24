import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const commandSchema = Type.Union(
  [
    "open",
    "back",
    "forward",
    "reload",
    "close",
    "click",
    "dblclick",
    "fill",
    "type",
    "hover",
    "focus",
    "check",
    "uncheck",
    "select",
    "press",
    "scroll",
    "scrollintoview",
    "wait",
    "read",
    "snapshot",
    "screenshot",
    "get",
    "is",
    "set",
    "a11y",
    "vitals",
  ].map((value) => Type.Literal(value)),
);

const browserSchema = Type.Object({
  command: commandSchema,
  args: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Arguments for the selected bounded browser command. Use simple selectors, values, or the documented command-specific options.",
      maxItems: 64,
    }),
  ),
  session: Type.Optional(
    Type.String({
      pattern: "^[A-Za-z0-9_-]{1,38}$",
      description: "Optional stable browser session name",
    }),
  ),
});

function defaultSession(cwd: string): string {
  return `p${createHash("sha256").update(cwd).digest("hex").slice(0, 20)}`;
}

async function readJsonBounded(response: Response, maximum = 1024 * 1024) {
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
    throw new Error("mewa-browser screenshot exceeded 64 MiB");
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
      throw new Error("mewa-browser screenshot exceeded 64 MiB");
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

function boundedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export default function mewaBrowser(pi: ExtensionAPI) {
  const baseUrl = (process.env.MEWA_BROWSER_URL ?? "http://mewa-browser:8787").replace(/\/$/, "");
  const token = process.env.MEWA_BROWSER_TOKEN;

  pi.registerTool({
    name: "browser",
    label: "browser",
    description:
      "Control the isolated visual-testing browser. Browser state is session-scoped, URLs are restricted to HTTP(S), and screenshots are retrieved as image results.",
    parameters: browserSchema,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!token) throw new Error("MEWA_BROWSER_TOKEN is not configured");
      const session = params.session ?? defaultSession(ctx.cwd);
      const response = await fetch(`${baseUrl}/v1/browser`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          session,
          command: params.command,
          args: params.args ?? [],
        }),
        redirect: "error",
        signal: boundedSignal(signal, 130_000),
      });
      const result = (await readJsonBounded(response)) as {
        outcome?: string;
        code?: string | number;
        stdout?: string;
        stderr?: string;
        warnings?: string[];
        hints?: string[];
        artifact?: { url: string; name: string };
      };
      if (!response.ok) {
        const details = [
          ...(result.warnings ?? []),
          ...(result.hints ?? []).map((hint) => `hint: ${hint}`),
        ].join("\n");
        throw new Error(`mewa-browser ${result.code ?? response.status}: ${details || response.statusText}`);
      }

      const text = [result.stdout, result.stderr]
        .filter((value): value is string => Boolean(value?.trim()))
        .join("\n");
      const content: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text: text || `${params.command} completed` }];

      if (result.artifact?.url) {
        const artifactResponse = await fetch(`${baseUrl}${result.artifact.url}`, {
          headers: { authorization: `Bearer ${token}` },
          redirect: "error",
          signal: boundedSignal(signal, 30_000),
        });
        if (!artifactResponse.ok) throw new Error("mewa-browser could not retrieve screenshot artifact");
        const mimeType = artifactResponse.headers.get("content-type")?.split(";", 1)[0] ?? "";
        if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) {
          throw new Error(`mewa-browser returned an unsupported screenshot type: ${mimeType || "missing"}`);
        }
        const bytes = await readBytesBounded(artifactResponse, 64 * 1024 * 1024);
        content.push({
          type: "image",
          data: Buffer.from(bytes).toString("base64"),
          mimeType,
        });
      }

      return {
        content,
        details: {
          session,
          command: params.command,
          code: result.code,
          artifact: result.artifact?.name,
        },
      };
    },
  });
}
