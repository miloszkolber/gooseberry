import { expect, test } from "bun:test";
import { changeNamesResource } from "@/files/tabs/use-live-tab-content";

test("matches a changed file only in its originating root", () => {
	const tab = { projectAreaId: "project", root: "/work/one", path: "src/index.ts" };
	expect(changeNamesResource({ root: "/work/one", path: "src/index.ts" }, tab)).toBe(true);
	expect(changeNamesResource({ root: "/work/two", path: "src/index.ts" }, tab)).toBe(false);
});

test("matches repository-relative diffs against root-relative watcher paths", () => {
	const tab = {
		projectAreaId: "project",
		repository: "/work/root/packages/app",
		path: "src/index.ts",
	};
	expect(changeNamesResource({ root: "/work/root", path: "packages/app/src/index.ts" }, tab)).toBe(
		true,
	);
});
