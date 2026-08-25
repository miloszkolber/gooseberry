import {
	type AppConfig,
	type AppConfigPatch,
	DEFAULT_SIGNET_SETTINGS,
	normalizeModelReferences,
	type SignetSettings,
} from "@mewa-code/contracts";
import { loadConfig, saveConfig } from "../persistence";

type SettingsPublisher = (config: AppConfig) => void;

let publishSettings: SettingsPublisher | null = null;

export function setSettingsPublisher(fn: SettingsPublisher | null): void {
	publishSettings = fn;
}

let cached: AppConfig | null = null;

function normalizeSignetSettings(value: unknown): SignetSettings {
	const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
	const enabled = Reflect.get(raw, "enabled");
	const address = Reflect.get(raw, "address");
	const port = Reflect.get(raw, "port");
	const normalizedAddress = typeof address === "string" ? address.trim() : "";
	const validAddress =
		Boolean(normalizedAddress) &&
		!/[\s/\\\0]/.test(normalizedAddress) &&
		!normalizedAddress.includes("://");
	return {
		enabled: typeof enabled === "boolean" ? enabled : DEFAULT_SIGNET_SETTINGS.enabled,
		address: validAddress ? normalizedAddress : DEFAULT_SIGNET_SETTINGS.address,
		port:
			typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65_535
				? port
				: DEFAULT_SIGNET_SETTINGS.port,
	};
}

function normalizeConfig(value: AppConfig): AppConfig {
	return {
		signet: normalizeSignetSettings(value.signet),
		hiddenModels: normalizeModelReferences(value.hiddenModels),
	};
}

export function getConfig(): AppConfig {
	cached ??= normalizeConfig(loadConfig());
	return cached;
}

export function updateConfig(partial: AppConfigPatch): AppConfig {
	const current = getConfig();
	const next: AppConfig = normalizeConfig({
		...current,
		...partial,
		signet: {
			...current.signet,
			...(partial.signet ?? {}),
		},
	});
	saveConfig(next);
	cached = next;
	publishSettings?.(next);
	return next;
}

export function resetConfigCache(): void {
	cached = null;
}

export async function getSignetStatus(): Promise<import("@mewa-code/contracts").SignetStatus> {
	const { enabled, address, port } = getConfig().signet;
	const host = address.includes(":") ? `[${address}]` : address;
	const endpoint = `http://${host}:${port}`;
	if (!enabled) return { enabled, endpoint, reachable: false };
	try {
		const response = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2_000) });
		return { enabled, endpoint, reachable: response.ok };
	} catch {
		return { enabled, endpoint, reachable: false };
	}
}
