import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isImagePath } from "@/files/file-kind";
import { FilePane } from "@/files/file-pane";
import { openFileInTab } from "@/files/open-tabs";
import { projectArea, useAppStore } from "@/store";

afterEach(() => useAppStore.setState(useAppStore.getInitialState(), true));

test("image tabs retain root identity without reading binary data through the text transport", async () => {
	useAppStore.setState(useAppStore.getInitialState(), true);
	const project = {
		id: "images",
		name: "Images",
		roots: ["/work/a", "/work/b"],
		slug: "images",
		lastOpened: 1,
	};
	useAppStore.setState({ projects: [project], projectAreas: { images: [projectArea(project)] } });
	// No transport is initialized: image bytes belong to the authenticated HTTP route.
	expect(await openFileInTab("images", "picture.PNG", "keep", undefined, "/work/a")).toBe(true);
	expect(await openFileInTab("images", "picture.PNG", "keep", undefined, "/work/b")).toBe(true);
	const tabs = useAppStore.getState().tabsByProjectArea.images ?? [];
	expect(tabs).toHaveLength(2);
	expect(tabs[0]?.id).not.toBe(tabs[1]?.id);
	expect(tabs[0]).toMatchObject({ root: "/work/a", path: "picture.PNG", content: "" });
	expect(tabs[1]).toMatchObject({ root: "/work/b", path: "picture.PNG", content: "" });
	for (const path of ["photo.jpeg", "photo.jpg", "animation.gif", "picture.webp"])
		expect(isImagePath(path)).toBe(true);
	for (const path of ["vector.svg", "image.png.ts", "README.md"])
		expect(isImagePath(path)).toBe(false);
	useAppStore.setState({ removedProjectAreaIds: { images: true } });
	expect(await openFileInTab("images", "picture.PNG", "keep", undefined, "/work/a")).toBe(false);
});

test("binary text responses get a notice instead of a source-highlighting workload", () => {
	const markup = renderToStaticMarkup(
		<FilePane
			tab={{
				kind: "file",
				id: "binary",
				projectAreaId: "images",
				root: "/work/a",
				name: "archive.zip",
				path: "archive.zip",
				content: "PK\0binary bytes",
			}}
		/>,
	);
	expect(markup).toContain("Binary file");
	expect(markup).not.toContain("binary bytes");
	expect(markup).not.toContain("<pre");
});
