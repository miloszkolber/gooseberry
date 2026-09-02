import type { McpAppAttachment, McpAppPermissions, McpAppToolResult } from "@gooseberry/contracts";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { AppWindow, Loader2, RotateCw } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { errorText, getTransport } from "@/connection";
import type { ToolRenderProps } from "../../render/tool-registry";
import { toText } from "../tool-helpers";
import {
	APP_KEEP_ALIVE_INTERVAL_MS,
	readMcpAppHTML,
	renewMcpAppView,
	revokeMcpAppView,
} from "./mcp-app-client";
import { useMcpAppSession } from "./mcp-app-context";
import { OriginPinnedAppTransport } from "./mcp-app-transport";

type AppBridgeModule = typeof import("@modelcontextprotocol/ext-apps/app-bridge");
type AppBridgeInstance = InstanceType<AppBridgeModule["AppBridge"]>;

const TEARDOWN_TIMEOUT_MS = 1_000;
const PROXY_READY_TIMEOUT_MS = 10_000;
const INITIALIZED_TIMEOUT_MS = 10_000;
// Keep the replay request alive beyond the controller's one-minute client
// reaper so a response settled during a disconnect is either delivered or its
// unclaimed view is revoked before the browser drops the request.
const APP_OPEN_TIMEOUT_MS = 75_000;
export const MCP_APP_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms";

const APP_PERMISSIONS = [
	["camera", "Camera"],
	["microphone", "Microphone"],
	["geolocation", "Location"],
	["clipboardWrite", "Clipboard write"],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canOpenMcpApp(
	app: McpAppAttachment | undefined,
	status: ToolRenderProps["status"],
): app is McpAppAttachment {
	return Boolean(
		(status === "done" || status === "error") &&
			app &&
			app.toolName.trim() &&
			app.extensionName.trim() &&
			app.resourceUri.startsWith("ui://"),
	);
}

export function mcpAppPermissionLabels(permissions: McpAppPermissions | undefined): string[] {
	return APP_PERMISSIONS.filter(([key]) => permissions?.[key] !== undefined).map(
		([, label]) => label,
	);
}

/** Preserve valid MCP envelopes; normalize legacy scalar results for the app lifecycle. */
export function toMcpToolResult(value: unknown, failed = false): CallToolResult {
	const source = isRecord(value) ? value : undefined;
	const rawContent = source?.content;
	const content = Array.isArray(rawContent)
		? rawContent
		: Array.isArray(value)
			? value
			: value == null
				? []
				: [{ type: "text", text: typeof value === "string" ? value : toText(value) }];
	return {
		content: content as CallToolResult["content"],
		...(source && isRecord(source.structuredContent)
			? { structuredContent: source.structuredContent }
			: {}),
		...(failed || source?.isError === true ? { isError: true } : {}),
		...(source && isRecord(source._meta) ? { _meta: source._meta } : {}),
	};
}

function toCallToolResult(result: McpAppToolResult): CallToolResult {
	return {
		content: result.content as CallToolResult["content"],
		...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
		...(result.isError === undefined ? {} : { isError: result.isError }),
		...(result._meta ? { _meta: result._meta } : {}),
	};
}

function delayed(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeBridge(bridge: AppBridgeInstance, initialized: boolean): Promise<void> {
	const teardown = initialized
		? Promise.race([
				bridge.teardownResource({}).catch(() => undefined),
				delayed(TEARDOWN_TIMEOUT_MS),
			])
		: Promise.resolve();
	await teardown;
	await bridge.close().catch(() => {});
}

async function runAppOperation<T>(
	viewId: string,
	signal: AbortSignal,
	operation: (transport: ReturnType<typeof getTransport>, operationId: string) => Promise<T>,
): Promise<T> {
	const transport = getTransport();
	const operationId = crypto.randomUUID();
	const cancel = () => {
		void transport
			.request("session.appOperationCancel", { viewId, operationId }, { timeoutMs: 5_000 })
			.catch(() => {});
	};
	if (signal.aborted) cancel();
	else signal.addEventListener("abort", cancel, { once: true });
	try {
		return await operation(transport, operationId);
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}

function currentTheme(query: MediaQueryList): "light" | "dark" {
	return query.matches ? "light" : "dark";
}

interface AppRuntime {
	cancelled: boolean;
	initialized: boolean;
	sandboxReady: boolean;
	bridge: AppBridgeInstance | null;
	viewId: string | null;
	setup: Promise<void>;
	release: Promise<void> | null;
	permissionResolver: ((approved: boolean) => void) | null;
	lifecycle: AbortController;
	timers: Set<ReturnType<typeof setTimeout>>;
	cleanups: (() => void)[];
}

function cancelRuntime(runtime: AppRuntime): void {
	runtime.cancelled = true;
	runtime.lifecycle.abort(new Error("App view closed"));
	for (const timer of runtime.timers) clearTimeout(timer);
	runtime.timers.clear();
	const resolver = runtime.permissionResolver;
	runtime.permissionResolver = null;
	resolver?.(false);
}

function releaseRuntime(runtime: AppRuntime, graceful: boolean): Promise<void> {
	if (runtime.release) return runtime.release;
	runtime.release = (async () => {
		for (const timer of runtime.timers) clearTimeout(timer);
		runtime.timers.clear();
		for (const cleanup of runtime.cleanups.splice(0)) cleanup();
		const bridge = runtime.bridge;
		runtime.bridge = null;
		if (bridge) await closeBridge(bridge, graceful && runtime.initialized);
		const viewId = runtime.viewId;
		runtime.viewId = null;
		if (viewId) await revokeMcpAppView(viewId).catch(() => {});
	})();
	return runtime.release;
}

interface AppFrameHandle {
	close: () => Promise<void>;
}

interface AppFrameProps {
	app: McpAppAttachment;
	toolCallId: string;
	args: Record<string, unknown>;
	result: unknown;
	status: ToolRenderProps["status"];
	onRequestClose: () => Promise<void>;
}

const AppFrame = forwardRef<AppFrameHandle, AppFrameProps>(function AppFrame(
	{ app, toolCallId, args, result, status, onRequestClose },
	ref,
) {
	const session = useMcpAppSession();
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const runtimeRef = useRef<AppRuntime | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [state, setState] = useState<"loading" | "permission" | "ready" | "error" | "closing">(
		"loading",
	);
	const [failure, setFailure] = useState("");
	const [permissionLabels, setPermissionLabels] = useState<string[]>([]);

	useImperativeHandle(
		ref,
		() => ({
			close: async () => {
				const runtime = runtimeRef.current;
				if (!runtime) return;
				setState("closing");
				cancelRuntime(runtime);
				void runtime.setup.finally(() => releaseRuntime(runtime, true));
			},
		}),
		[],
	);

	const choosePermissions = useCallback((approved: boolean) => {
		const runtime = runtimeRef.current;
		const resolver = runtime?.permissionResolver;
		if (!runtime || !resolver || runtime.cancelled) return;
		runtime.permissionResolver = null;
		resolver(approved);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly restarts a failed bridge.
	useEffect(() => {
		const frame = iframeRef.current;
		if (!session || !frame?.contentWindow) {
			setState("error");
			setFailure("This app is no longer attached to an open chat.");
			return;
		}

		const runtime: AppRuntime = {
			cancelled: false,
			initialized: false,
			sandboxReady: false,
			bridge: null,
			viewId: null,
			setup: Promise.resolve(),
			release: null,
			permissionResolver: null,
			lifecycle: new AbortController(),
			timers: new Set(),
			cleanups: [],
		};
		runtimeRef.current = runtime;

		setState("loading");
		setFailure("");
		setPermissionLabels([]);

		const fail = (error: unknown, fallback: string) => {
			if (runtime.cancelled || runtimeRef.current !== runtime) return;
			cancelRuntime(runtime);
			setState("error");
			setFailure(errorText(error, fallback));
			void releaseRuntime(runtime, true);
		};
		const deadline = (ms: number, message: string) => {
			const timer = setTimeout(() => {
				runtime.timers.delete(timer);
				fail(new Error(message), message);
			}, ms);
			runtime.timers.add(timer);
			return timer;
		};
		const clearDeadline = (timer: ReturnType<typeof setTimeout> | undefined) => {
			if (timer === undefined) return;
			clearTimeout(timer);
			runtime.timers.delete(timer);
		};

		runtime.setup = (async () => {
			try {
				const bridgeModule = import("@modelcontextprotocol/ext-apps/app-bridge");
				const protocolModule = import("@modelcontextprotocol/sdk/types.js");
				const opened = await getTransport().request(
					"session.appOpen",
					{
						projectId: session.projectId,
						sessionId: session.sessionId,
						toolCallId,
						parentOrigin: window.location.origin,
					},
					{ timeoutMs: APP_OPEN_TIMEOUT_MS },
				);
				runtime.viewId = opened.viewId;
				if (runtime.cancelled) return;
				const viewScope = {
					projectId: session.projectId,
					sessionId: session.sessionId,
					toolCallId,
					viewId: opened.viewId,
				};
				let renewalPending = false;
				const renewLease = () => {
					if (runtime.cancelled || renewalPending) return;
					renewalPending = true;
					void renewMcpAppView(viewScope, runtime.lifecycle.signal)
						.catch((error) => {
							if (!runtime.lifecycle.signal.aborted) {
								fail(error, "The app view expired.");
							}
						})
						.finally(() => {
							renewalPending = false;
						});
				};
				const leaseTimer = setInterval(renewLease, APP_KEEP_ALIVE_INTERVAL_MS);
				runtime.cleanups.push(() => clearInterval(leaseTimer));

				const [{ AppBridge, buildAllowAttribute }, { JSONRPCMessageSchema }, loadedHTML] =
					await Promise.all([
						bridgeModule,
						protocolModule,
						readMcpAppHTML(opened, viewScope, runtime.lifecycle.signal),
					]);
				let appHTML: string | null = loadedHTML;
				if (runtime.cancelled || !frame.contentWindow) return;
				const sandboxOrigin = new URL(opened.url).origin;
				const labels = mcpAppPermissionLabels(opened.resource.permissions);
				let grantedPermissions: McpAppPermissions | undefined;
				if (labels.length > 0) {
					setPermissionLabels(labels);
					setState("permission");
					const approved = await new Promise<boolean>((resolve) => {
						runtime.permissionResolver = resolve;
					});
					runtime.permissionResolver = null;
					if (runtime.cancelled) return;
					if (approved) grantedPermissions = opened.resource.permissions;
					setState("loading");
				}
				if (runtime.cancelled || !frame.contentWindow) return;
				frame.allow = buildAllowAttribute(grantedPermissions);

				const themeQuery = window.matchMedia("(prefers-color-scheme: light)");
				let hostContext: McpUiHostContext = {
					theme: currentTheme(themeQuery),
					displayMode: "fullscreen",
					availableDisplayModes: ["fullscreen"],
					locale: navigator.language,
					timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					platform: "web",
				};

				const bridge = new AppBridge(
					null,
					{ name: "Gooseberry", version: "1" },
					{
						serverTools: {},
						serverResources: {},
						sandbox: {
							...(opened.resource.csp ? { csp: opened.resource.csp } : {}),
							...(grantedPermissions ? { permissions: grantedPermissions } : {}),
						},
					},
					{ hostContext },
				);
				runtime.bridge = bridge;

				const updateTheme = () => {
					if (runtime.cancelled) return;
					hostContext = { ...hostContext, theme: currentTheme(themeQuery) };
					bridge.setHostContext(hostContext);
				};
				themeQuery.addEventListener("change", updateTheme);
				runtime.cleanups.push(() => themeQuery.removeEventListener("change", updateTheme));

				bridge.oncalltool = async (params, extra) => {
					if (runtime.cancelled || !runtime.initialized) {
						throw new Error("The app has not completed initialization.");
					}
					return toCallToolResult(
						await runAppOperation(opened.viewId, extra.signal, (transport, operationId) =>
							transport.request(
								"session.appToolCall",
								{
									projectId: session.projectId,
									sessionId: session.sessionId,
									toolCallId,
									viewId: opened.viewId,
									operationId,
									name: params.name,
									...(params.arguments ? { arguments: params.arguments } : {}),
								},
								{ signal: extra.signal },
							),
						),
					);
				};
				bridge.onreadresource = async (params, extra) => {
					if (runtime.cancelled || !runtime.initialized) {
						throw new Error("The app has not completed initialization.");
					}
					const resource = await runAppOperation(
						opened.viewId,
						extra.signal,
						(transport, operationId) =>
							transport.request(
								"session.appResourceRead",
								{
									projectId: session.projectId,
									sessionId: session.sessionId,
									toolCallId,
									viewId: opened.viewId,
									operationId,
									uri: params.uri,
								},
								{ signal: extra.signal },
							),
					);
					return resource as ReadResourceResult;
				};
				bridge.onlistresources = async (params) => ({
					resources: params?.cursor
						? []
						: [
								{
									uri: app.resourceUri,
									name: app.toolName,
									mimeType: "text/html;profile=mcp-app",
								},
							],
				});
				bridge.onlistresourcetemplates = async () => ({ resourceTemplates: [] });
				let proxyReadyTimer: ReturnType<typeof setTimeout> | undefined;
				let initializedTimer: ReturnType<typeof setTimeout> | undefined;
				const onSandboxReady = () => {
					if (runtime.cancelled || runtime.sandboxReady) return;
					runtime.sandboxReady = true;
					bridge.removeEventListener("sandboxready", onSandboxReady);
					clearDeadline(proxyReadyTimer);
					initializedTimer = deadline(INITIALIZED_TIMEOUT_MS, "The app did not finish starting.");
					const html = appHTML;
					appHTML = null;
					if (html === null) {
						fail(
							new Error("The app content was already consumed."),
							"The app content could not be loaded.",
						);
						return;
					}
					void bridge
						.sendSandboxResourceReady({
							html,
							...(opened.resource.csp ? { csp: opened.resource.csp } : {}),
							...(grantedPermissions ? { permissions: grantedPermissions } : {}),
						})
						.catch((error) => {
							fail(error, "The app content could not be loaded.");
						});
				};
				const onInitialized = () => {
					if (runtime.cancelled || runtime.initialized || !runtime.sandboxReady) return;
					runtime.initialized = true;
					clearDeadline(initializedTimer);
					void (async () => {
						await bridge.sendToolInput({ arguments: args });
						await bridge.sendToolResult(toMcpToolResult(result, status === "error"));
						if (!runtime.cancelled && runtimeRef.current === runtime) setState("ready");
					})().catch((error) => {
						fail(error, "The app result could not be delivered.");
					});
				};
				const onAppRequestClose = () => {
					if (!runtime.cancelled) void onRequestClose();
				};
				bridge.addEventListener("sandboxready", onSandboxReady);
				bridge.addEventListener("initialized", onInitialized);
				bridge.addEventListener("requestteardown", onAppRequestClose);
				runtime.cleanups.push(
					() => bridge.removeEventListener("sandboxready", onSandboxReady),
					() => bridge.removeEventListener("initialized", onInitialized),
					() => bridge.removeEventListener("requestteardown", onAppRequestClose),
				);

				const target = frame.contentWindow;
				await bridge.connect(
					new OriginPinnedAppTransport(target, sandboxOrigin, JSONRPCMessageSchema),
				);
				if (runtime.cancelled) return;
				frame.src = opened.url;
				proxyReadyTimer = deadline(PROXY_READY_TIMEOUT_MS, "The app sandbox did not become ready.");
			} catch (error) {
				fail(error, "The app could not be opened.");
			}
		})();

		return () => {
			cancelRuntime(runtime);
			if (runtimeRef.current === runtime) runtimeRef.current = null;
			void runtime.setup.finally(() => releaseRuntime(runtime, true));
		};
	}, [app, args, attempt, onRequestClose, result, session, status, toolCallId]);

	return (
		<div className="relative min-h-0 flex-1 bg-container-project-bg">
			<iframe
				key={attempt}
				ref={iframeRef}
				title={`${app.toolName} interactive app`}
				sandbox={MCP_APP_IFRAME_SANDBOX}
				src="about:blank"
				className="h-full min-h-0 w-full border-0"
			/>
			{state !== "ready" ? (
				<div className="absolute inset-0 flex items-center justify-center bg-container-project-bg p-lg">
					{state === "permission" ? (
						<section
							aria-labelledby="mcp-app-permissions-title"
							className="flex w-full max-w-[28rem] flex-col gap-md"
						>
							<div className="flex flex-col gap-xs">
								<h3 id="mcp-app-permissions-title" className="tr-title-section text-text-default">
									{app.extensionName} requests browser access
								</h3>
								<p className="tr-text-ui text-text-muted">
									Choose whether to delegate these capabilities to this interactive view.
								</p>
							</div>
							<ul className="list-disc pl-lg tr-text-ui text-text-default">
								{permissionLabels.map((permission) => (
									<li key={permission}>{permission}</li>
								))}
							</ul>
							<div className="flex flex-wrap justify-end gap-sm">
								<Button variant="outline" size="sm" onClick={() => choosePermissions(false)}>
									Open without access
								</Button>
								<Button
									size="sm"
									aria-label={`Allow ${app.extensionName} to use ${permissionLabels.join(", ")}`}
									onClick={() => choosePermissions(true)}
								>
									Allow access
								</Button>
							</div>
						</section>
					) : state === "loading" || state === "closing" ? (
						<div className="flex items-center gap-sm text-text-muted tr-text-ui" role="status">
							<Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
							{state === "closing" ? "Closing app…" : "Loading app…"}
						</div>
					) : (
						<div
							className="flex w-full max-w-[28rem] flex-col items-center gap-md text-center"
							role="alert"
						>
							<p className="tr-text-ui text-feedback-error">{failure}</p>
							<Button variant="outline" size="sm" onClick={() => setAttempt((value) => value + 1)}>
								<RotateCw className="size-3" />
								Retry
							</Button>
						</div>
					)}
				</div>
			) : null}
		</div>
	);
});

export function McpAppView({
	toolCallId,
	args,
	result,
	app,
	status,
}: Pick<ToolRenderProps, "toolCallId" | "args" | "result" | "app" | "status">) {
	const session = useMcpAppSession();
	const [open, setOpen] = useState(false);
	const frameRef = useRef<AppFrameHandle>(null);
	const closingRef = useRef<Promise<void> | null>(null);
	const close = useCallback(async () => {
		if (closingRef.current) return closingRef.current;
		const pending = (async () => {
			try {
				await frameRef.current?.close();
			} finally {
				setOpen(false);
			}
		})();
		closingRef.current = pending;
		try {
			await pending;
		} finally {
			if (closingRef.current === pending) closingRef.current = null;
		}
	}, []);
	const changeOpen = useCallback(
		(next: boolean) => {
			if (next) {
				if (!closingRef.current) setOpen(true);
				return;
			}
			void close();
		},
		[close],
	);
	if (!session || !canOpenMcpApp(app, status)) return null;

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" data-testid="mcp-app-open">
					<AppWindow className="size-3" />
					Open app
				</Button>
			</DialogTrigger>
			{open ? (
				<DialogContent
					data-testid="mcp-app-dialog"
					className="h-[min(48rem,calc(100vh-2rem))] max-w-[min(72rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
				>
					<DialogHeader className="shrink-0 border-border-default border-b px-lg py-md pr-12">
						<DialogTitle>{app.toolName}</DialogTitle>
						<DialogDescription>Interactive view from {app.extensionName}</DialogDescription>
					</DialogHeader>
					<AppFrame
						ref={frameRef}
						app={app}
						toolCallId={toolCallId}
						args={args}
						result={result}
						status={status}
						onRequestClose={close}
					/>
				</DialogContent>
			) : null}
		</Dialog>
	);
}
