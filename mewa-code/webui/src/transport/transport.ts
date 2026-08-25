import type { WsMethodName, WsParams, WsResult, WsServerMessage } from "@mewa-code/contracts";
import { encodeCodeTokenProtocol, isCodeToken, WS_CHANNELS } from "@mewa-code/contracts";
import { randomId } from "../lib";
import { RequestError } from "./requestError";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
type PushHandler = (data: unknown) => void;

export interface TransportOptions {
	url?: string;
	onStatus?: (status: ConnectionStatus) => void;
	/** A runtime-only bootstrap override, primarily useful to embedding clients and tests. */
	token?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

const NON_REPLAYABLE_CHANNELS: ReadonlySet<string> = new Set([
	WS_CHANNELS.terminalData,
	WS_CHANNELS.terminalExit,
	WS_CHANNELS.terminalDetached,
	WS_CHANNELS.sessionDeleted,
]);

let clientId: string | undefined;

export const CODE_TOKEN_STORAGE_KEY = "mewa-code.token";

interface TokenBootstrapLocation {
	hash: string;
	pathname: string;
	search: string;
}

interface TokenBootstrapStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/** Capture a one-time URL-fragment token without leaving it in browser history. */
export function captureCodeToken(
	page: TokenBootstrapLocation,
	storage: TokenBootstrapStorage,
	replaceAddress: (address: string) => void,
): string | undefined {
	const fragment = page.hash.startsWith("#") ? page.hash.slice(1) : page.hash;
	let token: string | undefined;
	let hadAuthFragment = false;
	if (fragment) {
		const params = new URLSearchParams(fragment);
		const candidate = params.get("token");
		hadAuthFragment = params.getAll("token").length > 0;
		if (params.getAll("token").length === 1 && candidate && isCodeToken(candidate))
			token = candidate;
	}
	const search = new URLSearchParams(page.search);
	const hadAuthQuery = search.has("token") || search.has("codeToken");
	if (hadAuthFragment || hadAuthQuery) {
		search.delete("token");
		search.delete("codeToken");
		const query = search.toString();
		replaceAddress(`${page.pathname}${query ? `?${query}` : ""}`);
	}

	if (token) {
		try {
			storage.setItem(CODE_TOKEN_STORAGE_KEY, token);
		} catch {
			return undefined;
		}
		return token;
	}
	try {
		const stored = storage.getItem(CODE_TOKEN_STORAGE_KEY);
		return stored && isCodeToken(stored) ? stored : undefined;
	} catch {
		return undefined;
	}
}

function pageCodeToken(): string | undefined {
	if (typeof location === "undefined" || typeof window === "undefined") return undefined;
	let storage: Storage;
	try {
		storage = window.sessionStorage;
	} catch {
		return undefined;
	}
	return captureCodeToken(location, storage, (address) => {
		window.history.replaceState(null, "", address);
	});
}

function pageClientId(): string {
	if (clientId === undefined) clientId = randomId("client");
	return clientId;
}

function withClientId(url: string): string {
	const u = new URL(url);
	u.search = "";
	u.searchParams.set("client", pageClientId());
	// Authentication must never be copied into a WebSocket URL query or fragment.
	u.hash = "";
	return u.toString();
}

export interface RequestOptions {
	sessionId?: string;
	timeoutMs?: number;
}

export class WsTransport {
	private ws: WebSocket | null = null;
	private readonly url: string;
	private readonly token: string | undefined;
	private readonly onStatus: ((status: ConnectionStatus) => void) | undefined;
	private seq = 0;
	private readonly pending = new Map<
		string,
		{
			frame: string;
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	private readonly subscribers = new Map<string, Set<PushHandler>>();
	private readonly latest = new Map<string, unknown>();
	private ackQueue: string[] = [];
	private ackScheduled = false;
	private backoff = 500;

	constructor(opts: TransportOptions = {}) {
		this.url = opts.url ?? inferUrl();
		this.token = opts.token ?? pageCodeToken();
		this.onStatus = opts.onStatus;
	}

	httpBase(): string {
		const u = new URL(this.url);
		u.protocol = u.protocol === "wss:" ? "https:" : "http:";
		return u.origin;
	}

	connect(): void {
		this.onStatus?.("connecting");
		const url = withClientId(this.url);
		const protocol = this.token ? encodeCodeTokenProtocol(this.token) : undefined;
		const ws = protocol ? new WebSocket(url, protocol) : new WebSocket(url);
		this.ws = ws;
		ws.onopen = () => {
			if (this.ws !== ws) {
				ws.close();
				return;
			}
			this.backoff = 500;
			this.onStatus?.("connected");
			this.ackQueue = [];
			this.sendFrame(JSON.stringify({ resume: [...this.pending.keys()] }));
			for (const entry of this.pending.values()) this.sendFrame(entry.frame);
		};
		ws.onmessage = (ev) => this.handleMessage(ev.data);
		ws.onclose = () => {
			if (this.ws !== ws) return;
			this.ws = null;
			this.onStatus?.("disconnected");
			setTimeout(() => this.connect(), this.backoff);
			this.backoff = Math.min(this.backoff * 2, 10_000);
		};
		ws.onerror = () => ws.close();
	}

	request<M extends WsMethodName>(
		method: M,
		params: WsParams<M>,
		options: RequestOptions = {},
	): Promise<WsResult<M>> {
		const { sessionId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
		const id = `trpi_${++this.seq}`;
		const frame = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
		return new Promise<WsResult<M>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`request "${method}" timed out`));
			}, timeoutMs);
			this.pending.set(id, {
				frame,
				resolve: resolve as (v: unknown) => void,
				reject,
				timer,
			});
			this.sendFrame(frame);
		});
	}

	subscribe(channel: string, handler: PushHandler): () => void {
		let set = this.subscribers.get(channel);
		if (!set) {
			set = new Set();
			this.subscribers.set(channel, set);
		}
		set.add(handler);
		if (this.latest.has(channel)) handler(this.latest.get(channel));
		return () => {
			this.subscribers.get(channel)?.delete(handler);
		};
	}

	private queueAck(id: string): void {
		this.ackQueue.push(id);
		if (this.ackScheduled) return;
		this.ackScheduled = true;
		queueMicrotask(() => {
			this.ackScheduled = false;
			this.flushAcks();
		});
	}

	private flushAcks(): void {
		if (this.ackQueue.length === 0 || this.ws?.readyState !== WebSocket.OPEN) return;
		const ack = this.ackQueue;
		this.ackQueue = [];
		this.sendFrame(JSON.stringify({ ack }));
	}

	private sendFrame(frame: string): void {
		if (this.ws?.readyState !== WebSocket.OPEN) return;
		try {
			this.ws.send(frame);
		} catch {
			this.ws.close();
		}
	}

	private handleMessage(raw: unknown): void {
		if (typeof raw !== "string") return;
		let msg: WsServerMessage;
		try {
			msg = JSON.parse(raw) as WsServerMessage;
		} catch {
			return;
		}
		if ("channel" in msg) {
			if (!NON_REPLAYABLE_CHANNELS.has(msg.channel)) this.latest.set(msg.channel, msg.data);
			const set = this.subscribers.get(msg.channel);
			if (set) for (const handler of set) handler(msg.data);
			return;
		}
		this.queueAck(msg.id);
		const entry = this.pending.get(msg.id);
		if (!entry) return;
		clearTimeout(entry.timer);
		this.pending.delete(msg.id);
		if (msg.ok) {
			entry.resolve(msg.result);
			return;
		}
		const message = msg.error ?? "request failed";
		entry.reject(msg.errorCode ? new RequestError(msg.errorCode, message) : new Error(message));
	}
}

export function inferUrl(): string {
	const proto = location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${location.host}/ws`;
}
