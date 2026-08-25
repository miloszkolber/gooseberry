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
	type ResourceDiagnostic,
	type ResourceLoader,
	SettingsManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";
import type {
	PiProfileCapability,
	PiProfileCapabilityId,
	PiProfileDescriptor,
	PiProfileSettings,
	SkillCatalogEntry,
	SlashCommandInfo,
} from "@mewa-code/contracts";
import { DEFAULT_PI_PROFILE_SETTINGS } from "@mewa-code/contracts";
import { PiConnector } from "@signetai/connector-pi";
import { getConfig } from "../settings";
import { askUserQuestionExtension } from "./askUserQuestion";
import { oversizedImageGuard } from "./imageGuard";
import { protectedStateRoots } from "./protectedPaths";
import { protectedStateGuard } from "./protectedStateGuard";
import { sessionGoalExtension } from "./sessionGoalExtension";
import { decideSkill, type SkillAdmissionContext } from "./skillAdmission";
import { sshBashExtension } from "./sshBashExtension";
import { type SubagentHost, subagentExtension } from "./subagentExtension";
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
	const configuredUrl = process.env.SIGNET_DAEMON_URL?.trim() ?? "";
	if (!configuredUrl) return undefined;
	const configuredKey = `${configuredUrl}\0${getAgentDir()}`;
	if (signetExtensionState?.configuredKey === configuredKey) {
		return signetExtensionState.path;
	}

	const path = (async (): Promise<string | undefined> => {
		try {
			const connector = new PiConnector();
			await connector.install("");
			return connector.getConfigPath();
		} catch (error) {
			console.warn(
				`Signet memory extension unavailable: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
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

const PROFILE_SETTING_KEY: Record<
	Exclude<PiProfileCapabilityId, "protectedStateGuard">,
	keyof PiProfileSettings
> = {
	browser: "browser",
	webAccess: "webAccess",
	signetMemory: "signetMemory",
	goals: "goals",
	subagents: "subagents",
};

function profileChoiceEnabled(settings: PiProfileSettings, id: PiProfileCapabilityId): boolean {
	if (id === "protectedStateGuard") return true;
	return settings[PROFILE_SETTING_KEY[id]] !== false;
}

function profileCapability(
	id: PiProfileCapabilityId,
	label: string,
	description: string,
	available: boolean,
	settings: PiProfileSettings,
	options: { required?: boolean; unavailableReason?: string } = {},
): PiProfileCapability {
	const required = options.required === true;
	const enabled = required ? true : available && profileChoiceEnabled(settings, id);
	return {
		id,
		label,
		description,
		enabled,
		available,
		...(required ? { required: true } : {}),
		...(available || !options.unavailableReason
			? {}
			: { unavailableReason: options.unavailableReason }),
	};
}

export async function getPiProfile(): Promise<PiProfileDescriptor> {
	const settings = getConfig().piProfile ?? DEFAULT_PI_PROFILE_SETTINGS;
	const paths = resolveDevPaths();
	const signetConfigured = Boolean(process.env.SIGNET_DAEMON_URL?.trim());
	const signetPath = signetConfigured ? await resolveSignetExtensionPath() : undefined;
	return {
		id: "mewa",
		label: "Mewa",
		capabilities: [
			profileCapability(
				"browser",
				"Browser QA",
				"Bounded browser actions run through the isolated mewa-browser service.",
				paths.browserPath !== undefined,
				settings,
				{ unavailableReason: "The Mewa browser extension is not available." },
			),
			profileCapability(
				"webAccess",
				"Web access",
				"Search and fetch tools return source URLs for citations.",
				paths.webAccessPath !== undefined,
				settings,
				{ unavailableReason: "The Pi web-access extension is not available." },
			),
			profileCapability(
				"signetMemory",
				"Signet memory",
				"Recall and save durable context through the configured Signet connector.",
				signetPath !== undefined,
				settings,
				{
					unavailableReason: signetConfigured
						? "The Signet memory extension could not be loaded."
						: "Signet memory is not configured.",
				},
			),
			profileCapability(
				"goals",
				"Session goals",
				"Keep one visible goal active for each Pi session.",
				true,
				settings,
			),
			profileCapability(
				"subagents",
				"Subagents",
				"Run one explicitly requested child session through Mewa's built-in in-process Pi extension.",
				true,
				settings,
			),
			profileCapability(
				"protectedStateGuard",
				"Protected-state guard",
				"Keep Pi and Mewa credentials and state roots out of project-scoped access.",
				true,
				settings,
				{ required: true },
			),
		],
	};
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

function skillsGate(bundledPaths: string[], getCtx: () => SkillAdmissionContext) {
	return (current: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		const ctx = getCtx();
		return {
			...current,
			skills: current.skills.filter((skill) => {
				const { group, isPlugin } = skillGroup(skill, bundledPaths);
				const isProjectSkill = skill.sourceInfo.scope === "project";
				if (isProjectSkill && !ctx.trusted) return false;
				return decideSkill({ name: skill.name, isProjectSkill, group, isPlugin }, ctx) === "load";
			}),
		};
	};
}

function resolveSkillInputs(getCtx: () => SkillAdmissionContext): {
	additionalSkillPaths: string[];
	skillsOverride: ReturnType<typeof skillsGate>;
} {
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	return {
		additionalSkillPaths: bundledSkillPaths,
		skillsOverride: skillsGate(bundledSkillPaths, getCtx),
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
	getAdmission: () => SkillAdmissionContext,
	excludedExtensionPaths: readonly string[] = [],
	workspaceId = "",
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
			factory: sessionGoalExtension(workspaceId),
			hidden: true,
		},
		{
			name: "mewa-subagents",
			factory: subagentExtension(subagentHost),
			hidden: true,
		},
	];
	const skillInputs = resolveSkillInputs(getAdmission);
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
	const extensionPathsByCapability: Partial<Record<PiProfileCapabilityId, string>> = {
		...(defaultPaths.browserPath ? { browser: defaultPaths.browserPath } : {}),
		...(defaultPaths.webAccessPath ? { webAccess: defaultPaths.webAccessPath } : {}),
		...(signetPath ? { signetMemory: signetPath } : {}),
	};
	const extensionsOverride = (current: ReturnType<ResourceLoader["getExtensions"]>) => ({
		...current,
		extensions: current.extensions.filter((extension) => {
			const activeSettings = getConfig().piProfile ?? DEFAULT_PI_PROFILE_SETTINGS;
			if (excluded.has(resolve(extension.resolvedPath))) return false;
			if (managedSignetPath && resolve(extension.resolvedPath) === managedSignetPath) {
				return signetPath !== undefined && profileChoiceEnabled(activeSettings, "signetMemory");
			}
			const path = extensionPathsByCapability;
			for (const [id, configuredPath] of Object.entries(path)) {
				if (resolve(extension.resolvedPath) !== resolve(configuredPath)) continue;
				return profileChoiceEnabled(activeSettings, id as PiProfileCapabilityId);
			}
			if (extension.path === "<inline:mewa-goals>")
				return profileChoiceEnabled(activeSettings, "goals");
			if (extension.path === "<inline:mewa-subagents>")
				return profileChoiceEnabled(activeSettings, "subagents");
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
	settingsManager.setProjectTrusted(getAdmission().trusted);
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

function admissionCacheKey(cwd: string, ctx: SkillAdmissionContext): string {
	return JSON.stringify([
		cwd,
		ctx.trusted,
		[...ctx.disabled].sort(),
		[...ctx.disabledGroups].sort(),
		Object.entries(ctx.overrides).sort(([a], [b]) => a.localeCompare(b)),
	]);
}

const SKILL_LIST_TTL_MS = 5_000;
const skillListCache = new Map<string, { at: number; value: SlashCommandInfo[] }>();

export async function listSkillCommands(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SlashCommandInfo[]> {
	const cacheKey = admissionCacheKey(cwd, admission);
	const cached = skillListCache.get(cacheKey);
	if (cached && Date.now() - cached.at < SKILL_LIST_TTL_MS) return cached.value;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: getAgentDir(),
		settingsManager,
		...resolveSkillInputs(() => admission),
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

export async function listSkillCatalog(
	cwd: string,
	admission: SkillAdmissionContext,
): Promise<SkillCatalogEntry[]> {
	const bundledSkillPaths = bundled ? [bundled.skillsDir] : resolveDevPaths().skillPaths;
	const settingsManager = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
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
		const gated = skill.sourceInfo.scope === "project";
		const { group, isPlugin } = skillGroup(skill, bundledSkillPaths);
		const decision =
			gated && !admission.trusted
				? "untrusted"
				: decideSkill({ name: skill.name, isProjectSkill: gated, group, isPlugin }, admission);
		return {
			name: skill.name,
			description: skill.description,
			sourceInfo: skill.sourceInfo,
			gated,
			group,
			decision,
		};
	});
}
