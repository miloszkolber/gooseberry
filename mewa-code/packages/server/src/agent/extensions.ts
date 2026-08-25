import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import {
	createSyntheticSourceInfo,
	DefaultPackageManager,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionFactory,
	getAgentDir,
	type InlineExtension,
	type PathMetadata,
	type ResourceLoader,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type { SkillCatalogEntry, SlashCommandInfo } from "@mewa-code/contracts";
import { sshBashExtension } from "@mewa-code/mewa-remote";
import { PiConnector } from "@signetai/connector-pi";
import { getConfig } from "../settings";
import { askUserQuestionExtension } from "./ask-user-question";
import { oversizedImageGuard } from "./image-guard";
import { protectedStateRoots } from "./protected-paths";
import { protectedStateGuard } from "./protected-state-guard";
import { sessionGoalExtension } from "./session-goal-extension";
import { type SubagentHost, subagentExtension } from "./subagent-extension";
import { type BundledTrashHelpers, setBundledTrashHelpers } from "./trash";

export type BundledExtensionFactory = ExtensionFactory;

export interface BundledExtensions {
	factories: BundledExtensionFactory[];
	skillsDir: string;
	trashHelpers: BundledTrashHelpers;
}

let bundled: BundledExtensions | undefined;

export async function registerBundledRuntime(extensions: BundledExtensions): Promise<void> {
	bundled = extensions;
	setBundledTrashHelpers(extensions.trashHelpers);
	const [{ registerBunOAuthFlows }, { bedrockProviderModule }, { setBedrockProviderModule }] =
		await Promise.all([
			import("@earendil-works/pi-ai/bun-oauth"),
			import("@earendil-works/pi-ai/bedrock-provider"),
			import("@earendil-works/pi-ai/compat"),
		]);
	registerBunOAuthFlows();
	setBedrockProviderModule(bedrockProviderModule);
}

interface DevPaths {
	extensionPaths: string[];
	skillPaths: string[];
	browserPath?: string;
	webAccessPath?: string;
}

let devPaths: { key: string; paths: DevPaths } | undefined;

function resolveConfiguredPath(environmentName: string, packageName: string): string | undefined {
	const configured = process.env[environmentName]?.trim();
	if (configured) {
		const path = resolve(configured);
		return existsSync(path) ? path : undefined;
	}
	try {
		return createRequire(import.meta.url).resolve(packageName);
	} catch {
		return undefined;
	}
}

function resolveDevPaths(): {
	extensionPaths: string[];
	skillPaths: string[];
	browserPath?: string;
	webAccessPath?: string;
} {
	const key = [
		process.env.MEWA_CODE_WEB_ACCESS_EXTENSION_PATH?.trim() ?? "",
		process.env.MEWA_CODE_BROWSER_EXTENSION_PATH?.trim() ?? "",
	].join("\0");
	if (devPaths?.key === key) return devPaths.paths;
	const webAccessPath = resolveConfiguredPath(
		"MEWA_CODE_WEB_ACCESS_EXTENSION_PATH",
		"pi-web-access/index.ts",
	);
	const browserPath = resolveConfiguredPath(
		"MEWA_CODE_BROWSER_EXTENSION_PATH",
		"@mewa-code/pi-mewa-browser",
	);
	const paths: DevPaths = {
		extensionPaths: [webAccessPath, browserPath].filter(
			(path): path is string => path !== undefined,
		),
		skillPaths: [],
		...(browserPath ? { browserPath } : {}),
		...(webAccessPath ? { webAccessPath } : {}),
	};
	devPaths = { key, paths };
	return paths;
}

let signetExtensionState: { configuredKey: string; path: Promise<string | undefined> } | undefined;

/**
 * Signet's public connector owns the bundled extension and its managed install
 * path. Keep installation lazy and opt-in so an unavailable daemon never
 * prevents an otherwise valid Pi session from starting.
 */
async function resolveSignetExtensionPath(): Promise<string | undefined> {
	const settings = getConfig().signet;
	if (!settings.enabled) return undefined;
	const host = settings.address.includes(":") ? `[${settings.address}]` : settings.address;
	const configuredUrl = `http://${host}:${settings.port}`;
	const configuredKey = `${configuredUrl}\0${getAgentDir()}`;
	if (signetExtensionState?.configuredKey === configuredKey) {
		return signetExtensionState.path;
	}

	const path = (async (): Promise<string | undefined> => {
		const previousUrl = process.env.SIGNET_DAEMON_URL;
		try {
			process.env.SIGNET_DAEMON_URL = configuredUrl;
			const connector = new PiConnector();
			await connector.install("");
			return connector.getConfigPath();
		} catch (error) {
			console.warn(
				`Signet memory extension unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		} finally {
			if (previousUrl === undefined) delete process.env.SIGNET_DAEMON_URL;
			else process.env.SIGNET_DAEMON_URL = previousUrl;
		}
	})();
	signetExtensionState = { configuredKey, path };
	return path;
}

function signetManagedExtensionPath(): string | undefined {
	try {
		return resolve(new PiConnector().getConfigPath());
	} catch {
		return undefined;
	}
}

const headlessSearchPolicy: ExtensionFactory = (pi: ExtensionAPI) => {
	pi.on("tool_call", (event) => {
		if (event.toolName !== "web_search") return;
		const input = event.input as Record<string, unknown>;
		if (input.workflow == null) input.workflow = "none";
	});
};

function skillGroup(skill: Skill, bundledPaths: string[]): { group: string; isPlugin: boolean } {
	if (bundledPaths.some((path) => resolve(skill.filePath).startsWith(`${resolve(path)}/`))) {
		return { group: "bundled", isPlugin: false };
	}
	if (skill.sourceInfo.scope === "project") return { group: "project", isPlugin: false };
	if (skill.sourceInfo.scope === "user") return { group: "personal", isPlugin: false };
	return { group: "pi", isPlugin: false };
}

function resolveSkillInputs(): {
	additionalSkillPaths: string[];
} {
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	return {
		additionalSkillPaths: bundledSkillPaths,
	};
}

export function toSkillCommands(skills: readonly Skill[]): SlashCommandInfo[] {
	return skills.map((skill) => ({
		name: `skill:${skill.name}`,
		description: skill.description,
		source: "skill" as const,
		sourceInfo: skill.sourceInfo,
	}));
}

export async function buildResourceLoader(
	cwd: string,
	settingsManager: SettingsManager,
	excludedExtensionPaths: readonly string[] = [],
	projectId = "",
	subagentHost: SubagentHost = {
		runChildSession: async () => {
			throw new Error("The Mewa subagent host is unavailable.");
		},
	},
): Promise<ResourceLoader> {
	const defaultPaths = resolveDevPaths();
	const signetPath = await resolveSignetExtensionPath();
	const managedSignetPath = signetManagedExtensionPath();
	const sharedFactories: InlineExtension[] = [
		{ name: "mewa-headless-search-policy", factory: headlessSearchPolicy, hidden: true },
		{ name: "mewa-ask-user-question", factory: askUserQuestionExtension, hidden: true },
		{ name: "mewa-image-guard", factory: oversizedImageGuard, hidden: true },
		{ name: "mewa-ssh-bash", factory: sshBashExtension, hidden: true },
		{
			name: "mewa-goals",
			factory: sessionGoalExtension(projectId),
			hidden: true,
		},
		{
			name: "mewa-subagents",
			factory: subagentExtension(subagentHost),
			hidden: true,
		},
	];
	const skillInputs = resolveSkillInputs();
	const agentDir = getAgentDir();
	const guardedFactories: InlineExtension[] = [
		...sharedFactories,
		{
			name: "mewa-protected-state-guard",
			factory: protectedStateGuard(cwd, protectedStateRoots({ agentDir })),
			hidden: true,
		},
	];
	const common = {
		cwd,
		agentDir,
		settingsManager,
		...skillInputs,
	};

	const excluded = new Set(excludedExtensionPaths.map((path) => resolve(path)));
	const discoveredExtensionPaths: string[] = [];
	const discoveredMetadata = new Map<string, PathMetadata>();
	if (excluded.size > 0) {
		await settingsManager.reload();
		const resolvedResources = await new DefaultPackageManager({
			cwd,
			agentDir,
			settingsManager,
		}).resolve();
		for (const resource of resolvedResources.extensions) {
			if (!resource.enabled || excluded.has(resolve(resource.path))) continue;
			discoveredExtensionPaths.push(resource.path);
			discoveredMetadata.set(resolve(resource.path), resource.metadata);
		}
	}

	const additionalExtensionPaths = [
		...(bundled ? [] : defaultPaths.extensionPaths),
		...(signetPath ? [signetPath] : []),
		...discoveredExtensionPaths,
	].filter((path) => !excluded.has(resolve(path)));
	const extensionsOverride = (current: ReturnType<ResourceLoader["getExtensions"]>) => ({
		...current,
		extensions: current.extensions.filter((extension) => {
			if (excluded.has(resolve(extension.resolvedPath))) return false;
			if (managedSignetPath && resolve(extension.resolvedPath) === managedSignetPath) {
				return signetPath !== undefined;
			}
			return true;
		}),
	});
	const loader = new DefaultResourceLoader(
		bundled
			? {
					...common,
					extensionsOverride,
					...(excluded.size > 0 ? { noExtensions: true } : {}),
					additionalExtensionPaths,
					extensionFactories: [...bundled.factories, ...guardedFactories],
				}
			: {
					...common,
					extensionsOverride,
					...(excluded.size > 0 ? { noExtensions: true } : {}),
					additionalExtensionPaths,
					extensionFactories: guardedFactories,
				},
	);
	await loader.reload();

	for (const extension of loader.getExtensions().extensions) {
		const metadata = discoveredMetadata.get(resolve(extension.resolvedPath));
		if (!metadata) continue;
		extension.sourceInfo = createSyntheticSourceInfo(extension.path, metadata);
		for (const command of extension.commands.values()) command.sourceInfo = extension.sourceInfo;
		for (const tool of extension.tools.values()) tool.sourceInfo = extension.sourceInfo;
	}
	return loader;
}

const SKILL_LIST_TTL_MS = 5_000;
const skillListCache = new Map<string, { at: number; value: SlashCommandInfo[] }>();

export async function listSkillCommands(cwd: string): Promise<SlashCommandInfo[]> {
	const cacheKey = cwd;
	const cached = skillListCache.get(cacheKey);
	if (cached && Date.now() - cached.at < SKILL_LIST_TTL_MS) return cached.value;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false });
	settingsManager.setProjectTrusted(settingsManager.getDefaultProjectTrust() === "always");
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		...resolveSkillInputs(),
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	const value = toSkillCommands(loader.getSkills().skills);
	skillListCache.set(cacheKey, { at: Date.now(), value });
	return value;
}

export async function listSkillCatalog(cwd: string): Promise<SkillCatalogEntry[]> {
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: false });
	settingsManager.setProjectTrusted(settingsManager.getDefaultProjectTrust() === "always");
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		additionalSkillPaths: bundledSkillPaths,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await loader.reload();
	return loader.getSkills().skills.map((skill) => {
		const { group } = skillGroup(skill, bundledSkillPaths);
		return {
			name: skill.name,
			description: skill.description,
			sourceInfo: skill.sourceInfo,
			gated: false,
			group,
			decision: "load",
		};
	});
}
