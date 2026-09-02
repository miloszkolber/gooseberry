import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionModeControl } from "@/chat/session/session-mode-control";
import { SessionPlanContent, SessionPlanControl } from "@/chat/session/session-plan-control";

test("session agent controls expose the current mode and safe bounded plan content", () => {
	const mode = renderToStaticMarkup(
		<SessionModeControl
			sessionId="chat"
			modes={{
				currentModeId: "code",
				availableModes: [
					{ id: "ask", name: "Ask", description: "Discuss before changing files" },
					{ id: "code", name: "Code", description: "Make changes to the project" },
				],
			}}
		/>,
	);
	expect(mode).toContain('data-testid="session-mode-trigger"');
	expect(mode).toContain('aria-label="Session mode"');
	expect(mode).toContain("aria-describedby=");
	expect(mode).toContain("Make changes to the project");
	expect(mode).toContain(
		'<option value="code" title="Make changes to the project" selected="">Code</option>',
	);

	const plan = renderToStaticMarkup(
		<SessionPlanContent
			planState={{
				entries: [
					{ content: "Read <script>alert(1)</script>", priority: "high", status: "completed" },
					{ content: "Implement", priority: "medium", status: "in_progress" },
				],
				truncated: true,
			}}
		/>,
	);
	expect(plan).toContain('data-testid="session-plan-content"');
	expect(plan).toContain("1 of 2 complete");
	expect(plan).toContain('<span class="sr-only">Completed: </span>');
	expect(plan).toContain('<span class="sr-only">In progress: </span>');
	expect(plan).toContain("Plan shortened to fit display limits.");
	expect(plan).toContain("Read &lt;script&gt;alert(1)&lt;/script&gt;");
	expect(plan).not.toContain("<script>");

	const limitedTrigger = renderToStaticMarkup(
		<SessionPlanControl planState={{ entries: [], truncated: true }} />,
	);
	expect(limitedTrigger).toContain('data-testid="session-plan-trigger"');
	expect(limitedTrigger).toContain('aria-label="Session plan, shortened to fit display limits"');
	expect(limitedTrigger).toContain("Limited");

	const limitedContent = renderToStaticMarkup(
		<SessionPlanContent planState={{ entries: [], truncated: true }} />,
	);
	expect(limitedContent).toContain("Plan shortened to fit display limits.");
	expect(limitedContent).not.toContain("0 of 0 complete");
	expect(limitedContent).not.toContain('aria-label="Plan steps"');
});
