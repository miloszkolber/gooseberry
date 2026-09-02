import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionLineageControl } from "@/chat/session/session-lineage-control";

test("fork lineage exposes accessible available and deleted-parent states", () => {
	for (const [parentDeleted, label, disabled] of [
		[false, "Open parent chat", false],
		[true, "Forked from an unavailable chat", true],
	] as const) {
		const markup = renderToStaticMarkup(
			<SessionLineageControl
				projectAreaId="project"
				parentSessionId="parent"
				parentDeleted={parentDeleted}
			/>,
		);
		expect(markup).toContain(`aria-label="${label}"`);
		expect(markup).toContain("Forked from chat");
		expect(/<button[^>]*\sdisabled(?:=| |>)/.test(markup)).toBe(disabled);
	}
});
