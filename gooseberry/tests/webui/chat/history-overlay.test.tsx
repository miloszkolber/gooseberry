import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryOverlay } from "@/chat/history/history-overlay";

test("history search announces the keyboard-selected result", () => {
	const markup = renderToStaticMarkup(
		<HistoryOverlay
			state={{
				open: true,
				stage: "compact",
				query: "deploy",
				scope: { kind: "chat", sessionId: "chat-1" },
				result: {
					prompts: [
						{
							text: "Deploy the service",
							timestamp: 1,
							sessionId: "chat-1",
							cwd: "/project",
						},
					],
					messages: [],
					promptTotal: 1,
					messageTotal: 0,
					indexing: false,
					incomplete: false,
				},
				selected: 0,
				error: false,
			}}
			projectAreaNames={{}}
			onQueryChange={() => {}}
			onToggleStage={() => {}}
			onMoveSelection={() => {}}
			onClose={() => {}}
			onInsert={() => {}}
			onInsertAndSend={() => {}}
			onOpenMessage={() => {}}
			onDeleteChat={() => {}}
			onSetScope={() => {}}
		/>,
	);
	expect(markup).toContain('type="search"');
	expect(markup).toContain("<ul");
	expect(markup).toContain("<li");
	expect(markup).toContain('aria-current="true"');
	expect(markup).toContain('role="status"');
	expect(markup).toContain("Selected 1 of 1: Deploy the service");
});
