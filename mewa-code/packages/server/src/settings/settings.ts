import {
	type AppConfig,
	type AppConfigPatch,
	DEFAULT_CONFIG,
	DEFAULT_PI_PROFILE_SETTINGS,
	normalizeModelReferences,
	type PiProfileSettings,
} from "@mewa-code/contracts";
import { loadConfig, saveConfig } from "../persistence";

type SettingsPublisher = (config: AppConfig) => void;

let publishSettings: SettingsPublisher | null = null;

export function setSettingsPublisher(fn: SettingsPublisher | null): void {
	publishSettings = fn;
}

let cached: AppConfig | null = null;

function normalizeProfileSettings(value: unknown): PiProfileSettings {
	const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
	const read = (key: keyof PiProfileSettings): boolean | undefined => {
		const candidate = Reflect.get(raw, key);
		return typeof candidate === "boolean" ? candidate : undefined;
	};
	return {
		browser: read("browser") ?? DEFAULT_PI_PROFILE_SETTINGS.browser,
		webAccess: read("webAccess") ?? DEFAULT_PI_PROFILE_SETTINGS.webAccess,
		signetMemory: read("signetMemory") ?? DEFAULT_PI_PROFILE_SETTINGS.signetMemory,
		goals: read("goals") ?? DEFAULT_PI_PROFILE_SETTINGS.goals,
		subagents: read("subagents") ?? DEFAULT_PI_PROFILE_SETTINGS.subagents,
	};
}

function normalizeConfig(value: AppConfig): AppConfig {
	return {
		...value,
		theme: typeof value.theme === "string" ? value.theme : DEFAULT_CONFIG.theme,
		piProfile: normalizeProfileSettings(value.piProfile),
		hiddenModels: normalizeModelReferences(value.hiddenModels),
	};
}

export function getConfig(): AppConfig {
	cached ??= normalizeConfig(loadConfig());
	return cached;
}

export function updateConfig(partial: AppConfigPatch): AppConfig {
	const current = getConfig();
	const currentProfile = current.piProfile ?? DEFAULT_PI_PROFILE_SETTINGS;
	const next: AppConfig = normalizeConfig({
		...current,
		...partial,
		piProfile: {
			...currentProfile,
			...(partial.piProfile ?? {}),
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
