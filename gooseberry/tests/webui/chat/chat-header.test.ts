import { expect, test } from "bun:test";
import { compile } from "svelte/compiler";

const component = new URL("../../../webui/src/chat/session/chat-header.svelte", import.meta.url);

test("toolbar status entries retain their complete title and compact truncation contract", async () => {
	const source = await Bun.file(component).text();
	expect(source).not.toMatch(/from ["'](?:react|react-dom|lucide-react)/);
	expect(compile(source, { filename: component.pathname, generate: false }).warnings).toEqual([]);
	expect(source).toContain('data-testid="chat-toolbar"');
	expect(source).toContain("{#each statusEntries as [key, text] (key)}");
	expect(source).toContain("title={text}");
	expect(source).toContain("max-w-40 truncate");
	expect(source).toContain("sm:max-w-64");
	expect(source).toContain("{@render left?.()}");
	expect(source).toContain("<SessionStatsBar {stats} />");
});
