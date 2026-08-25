import { expect, type Page, test } from "@playwright/test";
import {
	createWorkspaceViaDialog,
	enterDefaultWorkspace,
	openFixtureProject,
	waitTerminalReady,
} from "./fixtures/app";

interface ThemeOption {
	id: string;
	appearance: "light" | "dark";
	contrast: "normal" | "high";
	active: boolean;
}

async function openAppearance(page: Page) {
	await page.getByTestId("open-settings").click();
	const dialog = page.getByTestId("settings-dialog");
	await expect(dialog).toBeVisible();
	await page.getByTestId("settings-nav-appearance").click();
	await expect(dialog).toContainText("Theme");
	return dialog;
}

async function readThemeOptions(page: Page): Promise<ThemeOption[]> {
	const dialog = await openAppearance(page);
	const options = await dialog.locator('[data-testid^="theme-option-"]').evaluateAll((nodes) =>
		nodes.map((node) => ({
			id: node.getAttribute("data-theme-id") ?? "",
			appearance: node.getAttribute("data-appearance") === "light" ? "light" : "dark",
			contrast: node.getAttribute("data-contrast") === "high" ? "high" : "normal",
			active: node.getAttribute("data-active") === "true",
		})),
	);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	return options;
}

async function pickTheme(page: Page, theme: string): Promise<void> {
	const dialog = await openAppearance(page);
	await dialog.locator(`[data-theme-id="${theme}"]`).click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
}

async function expectEditorMatchesTheme(page: Page): Promise<void> {
	const colors = await page
		.locator(".monaco-editor")
		.first()
		.evaluate((editor) => {
			const token = getComputedStyle(document.documentElement)
				.getPropertyValue("--container-workspace-bg")
				.trim();
			const probe = document.createElement("div");
			probe.style.backgroundColor = token;
			document.body.append(probe);
			const expected = getComputedStyle(probe).backgroundColor;
			probe.remove();
			return { expected, actual: getComputedStyle(editor).backgroundColor };
		});
	expect(colors.actual).toBe(colors.expected);
}

test("appearance switches a discovered theme and persists it across reload", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");

	const options = await readThemeOptions(page);
	expect(options.length).toBeGreaterThan(1);
	const defaultTheme = options.find((option) => option.active)?.id;
	expect(defaultTheme).toBeTruthy();
	await expect(page.locator("html")).toHaveAttribute("data-theme", defaultTheme ?? "");

	const target = options.find((option) => option.id !== defaultTheme)?.id;
	expect(target).toBeTruthy();
	await pickTheme(page, target ?? "");

	await page.reload();
	await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", "connected");
	await expect(page.locator("html")).toHaveAttribute("data-theme", target ?? "");

	await pickTheme(page, defaultTheme ?? "");
});

test("Monaco opens files and re-themes under every discovered manifest", async ({ page }) => {
	await openFixtureProject(page);
	await createWorkspaceViaDialog(page);

	const options = await readThemeOptions(page);
	const defaultTheme = options.find((option) => option.active)?.id;
	expect(defaultTheme).toBeTruthy();
	expect(options.some((option) => option.contrast === "high")).toBe(true);
	const mountTheme = options.find((option) => option.appearance === "light") ?? options[0];
	expect(mountTheme).toBeDefined();
	await pickTheme(page, mountTheme?.id ?? "");

	await page.getByTestId("tab-files").click();
	const notes = page.getByTestId("file-node").filter({ hasText: "notes.txt" });
	await expect(notes).toBeVisible();
	await notes.dblclick();
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");

	for (const option of options) {
		await pickTheme(page, option.id);
		await expect(page.locator("html")).toHaveAttribute("data-theme-contrast", option.contrast);
		await expect(page.getByTestId("error-boundary-fallback")).toHaveCount(0);
		await expectEditorMatchesTheme(page);
		if (option.contrast === "high") {
			const selectedText = await page.locator("html").evaluate((root) => ({
				browser: getComputedStyle(root).getPropertyValue("--selection-text").trim(),
				editor: getComputedStyle(root).getPropertyValue("--editor-selection-text").trim(),
			}));
			expect(selectedText.browser).not.toBe("");
			expect(selectedText.editor).not.toBe("");
		}
	}

	await pickTheme(page, defaultTheme ?? "");
	await expect(page.getByTestId("editor-pane")).toContainText("plain-text-fixture");
});

test("fixed shell tabs expose selected state in high contrast", async ({ page }) => {
	await openFixtureProject(page);
	await enterDefaultWorkspace(page);

	const options = await readThemeOptions(page);
	const highContrast = options.find((option) => option.contrast === "high");
	expect(highContrast).toBeDefined();
	await pickTheme(page, highContrast?.id ?? "");

	await page.getByTestId("tab-files").click();
	const files = page.getByTestId("file-node");
	await files.filter({ hasText: "README.md" }).dblclick();
	await files.filter({ hasText: "notes.txt" }).click();
	await expect(page.getByTestId("editor-tab")).toHaveCount(2);

	await page.getByTestId("tab-terminal").click();
	await waitTerminalReady(page);
	await page.getByTestId("new-terminal").click();
	await expect(page.getByTestId("terminal-tab")).toHaveCount(2);

	await expect(
		page.locator('[data-testid="editor-tab"][data-active="true"] [role="tab"]'),
	).toHaveAttribute("aria-selected", "true");
	await expect(page.getByTestId("tab-terminal")).toHaveAttribute("aria-selected", "true");
	await expect(
		page.locator('[data-testid="terminal-tab"][data-active="true"] [aria-selected="true"]'),
	).toHaveCount(1);
});
