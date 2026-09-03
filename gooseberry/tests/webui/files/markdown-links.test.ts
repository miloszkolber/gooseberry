import { expect, test } from "bun:test";
import { projectFileUrl, resolveRelativePath } from "@/files/markdown/markdown-links";

test("resolves Markdown files inside the originating project root", () => {
	expect(resolveRelativePath("docs/guide.md", "../images/diagram one.png")).toBe(
		"images/diagram one.png",
	);
	expect(
		projectFileUrl(
			"http://controller.test:7312",
			"project one",
			"docs/guide.md",
			"../images/diagram one.png",
		),
	).toBe("http://controller.test:7312/files/project%20one/images/diagram%20one.png");
});

test("does not construct a file URL without a target path", () => {
	expect(projectFileUrl("", "project", "README.md", "")).toBeUndefined();
});
