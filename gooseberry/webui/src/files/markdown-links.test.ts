import { expect, test } from "bun:test";
import { projectFileUrl, resolveRelativePath } from "./markdown-links";

test("resolves Markdown files inside the originating project root", () => {
	expect(resolveRelativePath("docs/guide.md", "../images/diagram one.png")).toBe(
		"images/diagram one.png",
	);
	expect(
		projectFileUrl(
			"http://controller.test:7312",
			"project one",
			1,
			"docs/guide.md",
			"../images/diagram one.png",
		),
	).toBe("http://controller.test:7312/files/project%20one/1/images/diagram%20one.png");
});

test("does not construct a file URL after the originating root is removed", () => {
	expect(projectFileUrl("", "project", -1, "README.md", "image.png")).toBeUndefined();
});
