import { expect, test } from "bun:test";
import type { SlashCommandInfo } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	agentMentionLabel,
	agentMentionSummary,
	agentMentionTypeLabel,
	Composer,
	clampedMentionActiveIndex,
	clipboardImageName,
	insertedMention,
	insertImageTags,
	type MentionCandidate,
	mentionCompletionKeyAction,
	removeImageTag,
	removeImageTags,
	reserveClipboardImageNames,
	streamingSendModes,
	streamingSubmitBehavior,
} from "@/chat/composer/composer";
import { SlashCommandMenu } from "@/chat/composer/slash-command-completion";

const agentMention: MentionCandidate = {
	kind: "agent",
	name: "Reviewer",
	description: "Review the current change",
	sourceType: "agent",
	mention: "@reviewer",
};

test("keeps Goose agent mentions exact while preserving file mention syntax", () => {
	expect(insertedMention(agentMention)).toBe("@reviewer");
	expect(insertedMention({ kind: "file", name: "main.ts", path: "src/main.ts" })).toBe(
		"@src/main.ts",
	);
	expect(insertedMention({ kind: "dir", name: "src", path: "src" })).toBe("@src/");
});

test("defines a distinct accessible agent mention completion entry", () => {
	if (agentMention.kind !== "agent") throw new Error("agent mention fixture is invalid");
	expect(agentMentionLabel(agentMention)).toBe(
		"agent mention: Reviewer. Review the current change",
	);
	expect(agentMentionSummary(agentMention)).toBe("agent · Review the current change");
});

test("supports every official mention source type without inventing discovery", () => {
	for (const sourceType of [
		"skill",
		"builtinSkill",
		"recipe",
		"subrecipe",
		"agent",
		"project",
	] as const) {
		const candidate: MentionCandidate = {
			kind: "agent",
			name: "Source",
			description: "Exact Goose target",
			sourceType,
			mention: "@exact-goose-target",
		};
		expect(insertedMention(candidate)).toBe("@exact-goose-target");
		expect(agentMentionLabel(candidate)).toContain(agentMentionTypeLabel(sourceType));
	}
});

test("shrinking mention candidates clamps the active option and selects the visible entry", () => {
	expect(clampedMentionActiveIndex(4, 1)).toBe(0);
	expect(clampedMentionActiveIndex(4, 0)).toBe(0);
	expect(mentionCompletionKeyAction("Enter", true, 4, 1)).toEqual({ type: "select", index: 0 });
	expect(mentionCompletionKeyAction("Tab", true, 4, 1)).toEqual({ type: "select", index: 0 });
});

test("completion menus expose a coherent combobox and listbox contract", () => {
	const markup = renderToStaticMarkup(
		<Composer
			value="@rev"
			onChange={() => {}}
			isStreaming={false}
			commands={[]}
			mentionCandidates={[agentMention]}
			recentPrompts={[]}
			onMentionQuery={() => {}}
			onSubmit={() => true}
			onAbort={() => {}}
		/>,
	);
	expect(markup).toContain('role="combobox"');
	expect(markup).toContain('aria-expanded="true"');
	expect(markup).toContain('role="listbox"');
	expect(markup).toContain('role="option"');
	expect(markup).toContain('aria-selected="true"');
	expect(markup).toContain("aria-activedescendant=");
	expect(markup).toContain('data-testid="file-attach"');
	expect(markup).toContain('aria-label="Attach files or images"');
	expect(markup).toContain('type="file"');
	expect(markup).toContain('accept="image/png,image/jpeg,image/gif,image/webp,.c');
});

test("a streaming agent without steer queues text and exposes no image or steer affordance", () => {
	expect(streamingSubmitBehavior(false)).toBe("queue");
	expect(streamingSubmitBehavior(true)).toBe("steer");
	expect(streamingSendModes(false).map((mode) => mode.behavior)).toEqual(["queue", "interrupt"]);
	const markup = renderToStaticMarkup(
		<Composer
			value="follow up"
			onChange={() => {}}
			isStreaming
			commands={[]}
			mentionCandidates={[]}
			recentPrompts={[]}
			onMentionQuery={() => {}}
			onSubmit={() => true}
			onAbort={() => {}}
			supportsImages={false}
			supportsTextResources={false}
			supportsSteer={false}
		/>,
	);
	expect(markup).toContain('data-image-prompts="false"');
	expect(markup).toContain('data-text-resource-prompts="false"');
	expect(markup).toContain('aria-label="Queue follow-up"');
	expect(markup).not.toContain('data-testid="send-mode-steer"');
	expect(markup).not.toContain("Enter steers");
});

test("slash completion options retain listbox selection semantics", () => {
	const command: SlashCommandInfo = {
		name: "review",
		description: "Review the change",
		inputHint: "optional focus",
		source: "goose",
		sourceInfo: { path: "builtin", source: "goose", scope: "user", origin: "top-level" },
	};
	const markup = renderToStaticMarkup(
		<SlashCommandMenu commands={[command]} activeIndex={0} onSelect={() => {}} listboxId="slash" />,
	);
	expect(markup).toContain('id="slash"');
	expect(markup).toContain('id="slash-option-0"');
	expect(markup).toContain('role="option"');
	expect(markup).toContain('aria-selected="true"');
	expect(markup).toContain("/review");
	expect(markup).toContain("optional focus");
});

test("clipboard image tags use safe unique names and remove only their matching tag", () => {
	expect(clipboardImageName("", "image/png", ["image-1.png"], "[image-2.png]")).toBe("image-3.png");
	expect(clipboardImageName("image.jpeg", "image/jpeg", [], "")).toBe("image-1.jpg");
	expect(clipboardImageName("", "image/jpeg", ["image-1.png"], "")).toBe("image-2.jpg");
	expect(clipboardImageName("photo.png", "image/png", ["photo.png"], "")).toBe("photo-2.png");
	const inserted = insertImageTags("Inspect this", 7, 12, ["image-1.png", "image-2.jpg"]);
	expect(inserted).toEqual({
		value: "Inspect [image-1.png] [image-2.jpg]",
		caret: 35,
	});
	expect(removeImageTag(inserted.value, "image-1.png")).toBe("Inspect  [image-2.jpg]");
});

test("concurrent clipboard reservations keep paste order when image conversions settle in reverse", async () => {
	const first = reserveClipboardImageNames([{ name: "", type: "image/png" }], [], "");
	const firstDraft = insertImageTags("", 0, 0, first);
	const second = reserveClipboardImageNames(
		[{ name: "", type: "image/jpeg" }],
		first,
		firstDraft.value,
	);
	const secondDraft = insertImageTags(firstDraft.value, firstDraft.caret, firstDraft.caret, second);
	expect(first).toEqual(["image-1.png"]);
	expect(second).toEqual(["image-2.jpg"]);

	let finishFirst: (() => void) | undefined;
	let finishSecond: (() => void) | undefined;
	const firstConversion = new Promise<void>((resolve) => (finishFirst = resolve));
	const secondConversion = new Promise<void>((resolve) => (finishSecond = resolve));
	const settled: string[] = [];
	void firstConversion.then(() => settled.push(first[0] ?? ""));
	void secondConversion.then(() => settled.push(second[0] ?? ""));
	finishSecond?.();
	await Promise.resolve();
	expect(settled).toEqual(["image-2.jpg"]);
	expect(secondDraft.value).toBe("[image-1.png] [image-2.jpg]");
	finishFirst?.();
	await Promise.resolve();
	expect(settled).toEqual(["image-2.jpg", "image-1.png"]);
});

test("failed clipboard conversions remove their tag from the latest intervening draft", () => {
	const tagged = insertImageTags("Review", 6, 6, ["image-1.png", "image-2.jpg"]);
	const edited = `${tagged.value} after typing`;
	const removal = removeImageTags(edited, edited.length, ["image-1.png"]);
	expect(removal.value).toBe("Review  [image-2.jpg] after typing");
	expect(removal.caret).toBe(edited.length - "[image-1.png]".length);
});

test("slash command names remain separate from truncatable hints and descriptions", () => {
	const command: SlashCommandInfo = {
		name: "a-command-name-that-must-remain-fully-readable",
		description: "A description that may truncate independently",
		inputHint: "an input hint that may truncate independently",
		source: "goose",
		sourceInfo: { path: "builtin", source: "goose", scope: "user", origin: "top-level" },
	};
	const markup = renderToStaticMarkup(
		<SlashCommandMenu commands={[command]} activeIndex={0} onSelect={() => {}} />,
	);
	expect(markup).toContain('data-testid="slash-command-name"');
	expect(markup).toContain(`/${command.name}`);
	expect(markup).toContain('class="block break-all tr-code-text text-text-default"');
});
