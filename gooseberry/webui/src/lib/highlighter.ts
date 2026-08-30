import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { GOOSEBERRY_SHIKI_THEME, GOOSEBERRY_SHIKI_THEME_NAME } from "./shiki-theme";

const LANGUAGE_LOADERS = {
	typescript: () => import("@shikijs/langs/typescript"),
	tsx: () => import("@shikijs/langs/tsx"),
	javascript: () => import("@shikijs/langs/javascript"),
	jsx: () => import("@shikijs/langs/jsx"),
	json: () => import("@shikijs/langs/json"),
	bash: () => import("@shikijs/langs/bash"),
	python: () => import("@shikijs/langs/python"),
	go: () => import("@shikijs/langs/go"),
	css: () => import("@shikijs/langs/css"),
	html: () => import("@shikijs/langs/html"),
	markdown: () => import("@shikijs/langs/markdown"),
	diff: () => import("@shikijs/langs/diff"),
	yaml: () => import("@shikijs/langs/yaml"),
} as const;
type CanonicalLanguage = keyof typeof LANGUAGE_LOADERS;

const ALIAS: Record<string, string> = {
	ts: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
	golang: "go",
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	md: "markdown",
	yml: "yaml",
};

const EXTENSION_LANGUAGE: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	json: "json",
	jsonc: "json",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	py: "python",
	go: "go",
	css: "css",
	html: "html",
	htm: "html",
	md: "markdown",
	mdx: "markdown",
	yaml: "yaml",
	yml: "yaml",
};

export function languageForPath(path: string): string {
	const name = path.split("/").at(-1)?.toLowerCase() ?? "";
	if (["dockerfile", "containerfile"].includes(name)) return "bash";
	const extension = name.includes(".") ? (name.split(".").at(-1) ?? "") : "";
	return EXTENSION_LANGUAGE[extension] ?? "text";
}

let highlighterPromise: Promise<HighlighterCore> | null = null;
function getHighlighter(): Promise<HighlighterCore> {
	highlighterPromise ??= createHighlighterCore({
		themes: [GOOSEBERRY_SHIKI_THEME],
		langs: [],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}

const languageLoads = new Map<CanonicalLanguage, Promise<void>>();
function loadLanguage(highlighter: HighlighterCore, language: CanonicalLanguage): Promise<void> {
	let pending = languageLoads.get(language);
	if (!pending) {
		pending = LANGUAGE_LOADERS[language]().then(async (module) => {
			await highlighter.loadLanguage(module.default);
		});
		languageLoads.set(language, pending);
	}
	return pending;
}

export async function highlightCode(code: string, lang: string): Promise<string | null> {
	const key = lang.toLowerCase();
	const canonical = ALIAS[key] ?? key;
	if (!(canonical in LANGUAGE_LOADERS)) return null;
	try {
		const hl = await getHighlighter();
		await loadLanguage(hl, canonical as CanonicalLanguage);
		return hl.codeToHtml(code, { lang: canonical, theme: GOOSEBERRY_SHIKI_THEME_NAME });
	} catch {
		return null;
	}
}
