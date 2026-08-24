import { expect, test } from "bun:test";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { SYNTAX_VARIABLES } from "./runtime";
import { MEWA_CODE_SHIKI_THEME, MEWA_CODE_SHIKI_THEME_NAME } from "./shiki";

test("the TextMate map references exactly the semantic syntax variables", () => {
	const referenced = new Set<string>();
	for (const entry of MEWA_CODE_SHIKI_THEME.settings ?? []) {
		for (const color of [entry.settings?.foreground, entry.settings?.background]) {
			for (const match of (color ?? "").matchAll(/var\((--[a-z-]+)\)/g)) {
				if (match[1]) referenced.add(match[1]);
			}
		}
	}
	const expected = new Set<string>([...Object.values(SYNTAX_VARIABLES), "--container-content-bg"]);
	expect(referenced).toEqual(expected);
});

test("highlighted output carries CSS variables only, never a baked palette color", async () => {
	const highlighter = await createHighlighterCore({
		themes: [MEWA_CODE_SHIKI_THEME],
		langs: [import("@shikijs/langs/typescript")],
		engine: createJavaScriptRegexEngine(),
	});
	const html = highlighter.codeToHtml('const message = "hello"', {
		lang: "typescript",
		theme: MEWA_CODE_SHIKI_THEME_NAME,
	});
	expect(html).toContain("var(--code-");
	expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i);
	expect(html).not.toContain("--shiki-");
	highlighter.dispose();
});
