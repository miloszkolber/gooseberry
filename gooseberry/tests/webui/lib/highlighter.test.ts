import { expect, test } from "bun:test";
import { highlightCode, languageForPath } from "@/lib/highlighter";

test("Go source and fenced aliases share the lazy grammar", async () => {
	expect(languageForPath("controller/main.go")).toBe("go");
	const [source, fence] = await Promise.all([
		highlightCode("package main\nfunc main() {}", "go"),
		highlightCode("package main\nfunc main() {}", "golang"),
	]);
	expect(source).toContain("package");
	expect(source).toContain("<span style=");
	expect(fence).toBe(source);
});
