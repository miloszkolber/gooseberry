import { afterEach, expect, spyOn, test } from "bun:test";
import type { GitDiffFile } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { initTransport, resetTransport } from "@/connection";
import { WsTransport } from "@/connection/transport";
import { DiffPane } from "@/files/changes/diff-pane";
import { openDiffInTab } from "@/files/tabs/open-tabs";
import { type DiffTab, useAppStore } from "@/store";

afterEach(() => {
	resetTransport();
	useAppStore.setState(useAppStore.getInitialState(), true);
});

test("initial diff tabs retain unavailable reasons and rename source paths", async () => {
	const location = Object.getOwnPropertyDescriptor(globalThis, "location");
	Object.defineProperty(globalThis, "location", {
		value: new URL("http://localhost:7312"),
		configurable: true,
	});
	const connect = spyOn(WsTransport.prototype, "connect").mockImplementation(() => {});
	const transport = initTransport();
	const preview: GitDiffFile = {
		original: "",
		modified: "",
		originalPath: "old.bin",
		unavailable: true,
		binary: true,
		message: "Binary files cannot be previewed",
	};
	const request = spyOn(transport, "request").mockResolvedValue(preview);
	try {
		expect(
			await openDiffInTab(
				"project",
				{ kind: "uncommitted" },
				"new.bin",
				"keep",
				undefined,
				"/repo",
			),
		).toBe(true);
		expect(request).toHaveBeenCalledWith("git.diffFile", {
			projectId: "project",
			repository: "/repo",
			path: "new.bin",
			scope: { kind: "uncommitted" },
		});
		const tab = useAppStore.getState().tabsByProjectArea.project?.[0];
		expect(tab).toMatchObject(preview);
		if (tab?.kind !== "diff") throw new Error("diff tab missing");
		const markup = renderToStaticMarkup(<DiffPane tab={tab} />);
		expect(markup).toContain("old.bin → new.bin");
		expect(markup).toContain("Binary files cannot be previewed");
		expect(markup).not.toContain("source-diff");
	} finally {
		request.mockRestore();
		connect.mockRestore();
		if (location) Object.defineProperty(globalThis, "location", location);
		else Reflect.deleteProperty(globalThis, "location");
	}
});

test("refreshed diff notices replace each other and clear when text becomes available", () => {
	const initial: DiffTab = {
		kind: "diff",
		id: "diff",
		projectAreaId: "project",
		repository: "/repo",
		path: "new.txt",
		name: "new.txt",
		scope: { kind: "uncommitted" },
		loadedTarget: "",
		original: "before\n",
		modified: "after\n",
	};
	useAppStore.getState().openTab(initial, "keep");
	useAppStore.setState({ activeProjectAreaId: "project" });
	useAppStore.getState().setDiffTabIgnoreWhitespace(initial.id, true);
	// A failed deferred read acknowledges its tick using the captured tab.
	useAppStore.getState().updateDiffTabContent("project", initial.id, initial, 1, "");
	expect(useAppStore.getState().tabsByProjectArea.project?.[0]).toMatchObject({
		ignoreWhitespace: true,
	});
	let tick = 0;
	const refresh = (preview: GitDiffFile) => {
		useAppStore.getState().updateDiffTabContent("project", initial.id, preview, ++tick, "");
		const tab = useAppStore.getState().tabsByProjectArea.project?.[0];
		if (tab?.kind !== "diff") throw new Error("diff tab missing");
		return { tab, markup: renderToStaticMarkup(<DiffPane tab={tab} />) };
	};
	for (const preview of [
		{ original: "", modified: "", unavailable: true, binary: true, originalPath: "old.bin" },
		{ original: "", modified: "", unavailable: true, tooLarge: true },
		{ original: "", modified: "", unavailable: true, message: "File does not exist" },
	] satisfies GitDiffFile[]) {
		const { tab, markup } = refresh(preview);
		expect(tab.binary).toBe("binary" in preview ? preview.binary : undefined);
		expect(tab.tooLarge).toBe("tooLarge" in preview ? preview.tooLarge : undefined);
		expect(tab.originalPath).toBe("originalPath" in preview ? preview.originalPath : undefined);
		expect(markup).toContain('role="status"');
		expect(markup).toContain('disabled=""');
		expect(markup).not.toContain("source-diff");
	}
	const { tab, markup } = refresh({
		original: "before\n",
		modified: "after\n",
		originalPath: "old.txt",
	});
	expect(tab.unavailable).toBeUndefined();
	expect(tab.message).toBeUndefined();
	expect(markup).toContain("source-diff");
	expect(markup).toContain("--- a/old.txt");
	expect(markup).toContain("+++ b/new.txt");
	expect(markup).not.toContain('disabled=""');
});
