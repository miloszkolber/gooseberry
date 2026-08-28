import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { GOOSEBERRY_SHIKI_THEME, GOOSEBERRY_SHIKI_THEME_NAME } from "./shiki-theme";

const CANONICAL = new Set([
	"typescript",
	"tsx",
	"javascript",
	"jsx",
	"json",
	"bash",
	"python",
	"css",
	"html",
	"markdown",
	"diff",
	"yaml",
]);

const ALIAS: Record<string, string> = {
	ts: "typescript",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	py: "python",
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
		langs: [
			import("@shikijs/langs/typescript"),
			import("@shikijs/langs/tsx"),
			import("@shikijs/langs/javascript"),
			import("@shikijs/langs/jsx"),
			import("@shikijs/langs/json"),
			import("@shikijs/langs/bash"),
			import("@shikijs/langs/python"),
			import("@shikijs/langs/css"),
			import("@shikijs/langs/html"),
			import("@shikijs/langs/markdown"),
			import("@shikijs/langs/diff"),
			import("@shikijs/langs/yaml"),
		],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string | null> {
	const key = lang.toLowerCase();
	const canonical = ALIAS[key] ?? key;
	if (!CANONICAL.has(canonical)) return null;
	try {
		const hl = await getHighlighter();
		return hl.codeToHtml(code, { lang: canonical, theme: GOOSEBERRY_SHIKI_THEME_NAME });
	} catch {
		return null;
	}
}
