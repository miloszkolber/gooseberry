import { expect, test } from "bun:test";
import { safeBrowserURL } from "@gooseberry/contracts";
import { browserPanelScreenState, snapshotReferences } from "@/workspace/browser/browser-panel";
import { browserPanelAvailable } from "@/workspace/views/project-work-area";

test("browser UI stays gated until runtime reports a ready browser", () => {
	expect(browserPanelAvailable(null)).toBeFalse();
	expect(
		browserPanelAvailable({
			application: { state: "ready" },
			agent: { state: "ready" },
			browser: { state: "unavailable" },
		}),
	).toBeFalse();
	expect(
		browserPanelAvailable({
			application: { state: "ready" },
			agent: { state: "ready" },
			browser: { state: "ready" },
		}),
	).toBeTrue();
	expect(
		browserPanelAvailable({
			application: { state: "ready" },
			agent: { state: "ready" },
			browser: { state: "unavailable" },
		}),
	).toBeFalse();
});

test("browser panel validates URL entry and exposes explicit content states", () => {
	expect(safeBrowserURL("https://example.com/path")).toBe("https://example.com/path");
	expect(safeBrowserURL("javascript:alert(1)")).toBeNull();
	expect(safeBrowserURL("https://user@example.com")).toBeNull();
	expect(browserPanelScreenState(false, null, null)).toBe("empty");
	expect(browserPanelScreenState(true, null, null)).toBe("loading");
	expect(browserPanelScreenState(false, "failed", null)).toBe("error");
	expect(browserPanelScreenState(false, null, "/v1/artifacts/panel.png")).toBe("ready");
});

test("snapshot references are bounded and deduplicated for interaction controls", () => {
	expect(snapshotReferences('button "Save" @save\nlink @next\nbutton @save')).toEqual([
		"@save",
		"@next",
	]);
});
