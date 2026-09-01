import { expect, test } from "bun:test";
import type { SlashCommandInfo } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	agentMentionLabel,
	agentMentionSummary,
	agentMentionTypeLabel,
	Composer,
	clampedMentionActiveIndex,
	insertedMention,
	type MentionCandidate,
	mentionCompletionKeyAction,
} from "@/chat/composer";
import { SlashCommandMenu } from "@/chat/slash-command-completion";

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
	expect(markup).toContain("/review optional focus");
});
