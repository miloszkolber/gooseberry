import type { ProviderAuthKind, ProviderStatus, ProviderStatusReport } from "@mewa-code/contracts";
import { settledAvailableModels, usePiRuntime } from "../agent";

export interface ProviderStatusSources {
	modelProviderIds: Set<string>;
	availableProviders: Set<string>;
	modelCounts: ReadonlyMap<string, number>;
	availableModelCounts: ReadonlyMap<string, number>;
	credentialProviders: string[];
	oauthProviders: { id: string; name: string }[];
	credentialType: (id: string) => "oauth" | "api_key" | undefined;
	providerAuth: (id: string) => { source?: string; label?: string };
	apiKeyLogin: (id: string) => boolean;
	displayName: (id: string) => string;
	hasAuth: (id: string) => boolean;
}

function resolveKind(
	credentialType: "oauth" | "api_key" | undefined,
	source: string | undefined,
): ProviderAuthKind {
	if (credentialType === "oauth") return "oauth";
	if (credentialType === "api_key") return "api-key";
	switch (source) {
		case "environment":
			return "env";
		case "models_json_key":
		case "models_json_command":
		case "runtime":
			return "api-key";
		default:
			return "other";
	}
}

function resolveDetail(source?: string, label?: string): string | undefined {
	if (label) return label;
	if (source === "models_json_key") return "models.json";
	if (source === "models_json_command") return "models.json (command)";
	return undefined;
}

export function buildProviderReport(sources: ProviderStatusSources): ProviderStatusReport {
	const oauthIds = new Set(sources.oauthProviders.map((p) => p.id));
	const oauthName = new Map(sources.oauthProviders.map((p) => [p.id, p.name]));
	const removable = new Set(sources.credentialProviders);
	const ids = new Set<string>([
		...sources.modelProviderIds,
		...sources.credentialProviders,
		...oauthIds,
	]);
	const providers: ProviderStatus[] = [...ids].map((id) => {
		const registryName = sources.displayName(id);
		const name = registryName === id ? (oauthName.get(id) ?? registryName) : registryName;
		const canOAuth = oauthIds.has(id);
		const canApiKey = sources.apiKeyLogin(id);
		const login = {
			...(canOAuth ? { canOAuth: true } : {}),
			...(canApiKey ? { canApiKey: true } : {}),
			...(removable.has(id) ? { canLogout: true } : {}),
		};
		const modelCount = sources.modelCounts.get(id) ?? 0;
		const availableModelCount = sources.availableModelCounts.get(id) ?? 0;
		const configured = sources.hasAuth(id) || sources.availableProviders.has(id);
		if (!configured) {
			return { id, name, configured: false, modelCount, availableModelCount, ...login };
		}
		const { source, label } = sources.providerAuth(id);
		const kind = resolveKind(sources.credentialType(id), source);
		const detail = resolveDetail(source, label);
		return {
			id,
			name,
			configured: true,
			kind,
			...(detail !== undefined ? { detail } : {}),
			modelCount,
			availableModelCount,
			...login,
		};
	});

	providers.sort((a, b) => {
		if (a.configured !== b.configured) return a.configured ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return {
		providers,
	};
}

export async function getProviderStatus(): Promise<ProviderStatusReport> {
	return usePiRuntime(async (runtime) => {
		const registeredProviders = runtime.getProviders();
		try {
			await runtime.refresh({ providers: registeredProviders.map((provider) => provider.id) });
		} catch {
			throw new Error("Provider status refresh failed");
		}

		const allModels = runtime.getModels();
		const available = settledAvailableModels(runtime);
		const credentials = await runtime.listCredentials();
		const providerStatusIds = new Set<string>([
			...registeredProviders.map((provider) => provider.id),
			...allModels.map((model) => model.provider),
			...credentials.map((credential) => credential.providerId),
		]);
		const visibleProviders = [...providerStatusIds].flatMap((id) => {
			const provider = runtime.getProvider(id);
			return provider ? [provider] : [];
		});
		const credentialTypes = new Map(
			credentials.map((credential) => [credential.providerId, credential.type]),
		);

		const modelCounts = new Map<string, number>();
		for (const model of allModels) {
			modelCounts.set(model.provider, (modelCounts.get(model.provider) ?? 0) + 1);
		}
		const availableModelCounts = new Map<string, number>();
		for (const model of available) {
			availableModelCounts.set(model.provider, (availableModelCounts.get(model.provider) ?? 0) + 1);
		}

		return buildProviderReport({
			modelProviderIds: providerStatusIds,
			availableProviders: new Set(available.map((model) => model.provider)),
			modelCounts,
			availableModelCounts,
			credentialProviders: credentials.map((credential) => credential.providerId),
			oauthProviders: visibleProviders
				.filter((provider) => provider.auth.oauth)
				.map((provider) => ({
					id: provider.id,
					name: provider.auth.oauth?.name ?? provider.name,
				})),
			credentialType: (id) => credentialTypes.get(id),
			providerAuth: (id) => runtime.getProviderAuthStatus(id),
			apiKeyLogin: (id) => Boolean(runtime.getProvider(id)?.auth.apiKey?.login),
			displayName: (id) => runtime.getProvider(id)?.name ?? id,
			hasAuth: (id) => runtime.getProviderAuthStatus(id).configured,
		});
	});
}
