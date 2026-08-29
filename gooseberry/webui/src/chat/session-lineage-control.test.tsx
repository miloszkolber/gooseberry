import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionLineageControl } from "./session-lineage-control";

test("fork lineage offers an accessible parent navigation control", () => {
	const markup = renderToStaticMarkup(
		<SessionLineageControl
			projectAreaId="project"
			parentSessionId="parent"
			parentDeleted={false}
		/>,
	);
	expect(markup).toContain('aria-label="Open parent chat"');
	expect(markup).toContain("Forked from chat");
	expect(markup).not.toMatch(/<button[^>]*\sdisabled(?:=| |>)/);
});

test("fork lineage retains a disabled indication for a locally deleted parent", () => {
	const markup = renderToStaticMarkup(
		<SessionLineageControl projectAreaId="project" parentSessionId="parent" parentDeleted />,
	);
	expect(markup).toContain('aria-label="Forked from an unavailable chat"');
	expect(markup).toMatch(/<button[^>]*\sdisabled(?:=| |>)/);
	expect(markup).toContain("Forked from chat");
});
