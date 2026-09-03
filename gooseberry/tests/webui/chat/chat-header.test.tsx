import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatHeader } from "@/chat/session/chat-header";

test("toolbar status entries truncate while retaining the complete title", () => {
	const status = "A status message that is too long to fit in the compact toolbar";
	const markup = renderToStaticMarkup(
		<ChatHeader stats={null} statusEntries={[["long-status", status]]} />,
	);
	expect(markup).toContain(
		'title="A status message that is too long to fit in the compact toolbar"',
	);
	expect(markup).toContain("max-w-40 truncate");
});
