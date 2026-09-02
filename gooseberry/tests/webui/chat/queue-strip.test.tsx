import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueueStrip } from "@/chat/session/queue-strip";

const handlers = { onEdit: () => {}, onRemove: () => {}, onRetry: () => {} };

test("uncertain follow-ups explain and expose the explicit retry", () => {
	const ordinary = renderToStaticMarkup(
		<QueueStrip
			queue={{ revision: "ordinary", steering: [], followUp: ["later"] }}
			{...handlers}
		/>,
	);
	expect(ordinary).not.toContain("queue-item-retry");

	const blocked = renderToStaticMarkup(
		<QueueStrip
			queue={{
				revision: "blocked",
				steering: [],
				followUp: ["possibly sent"],
				blocked: { lane: "followUp", index: 0, reason: "delivery-uncertain" },
			}}
			{...handlers}
		/>,
	);
	expect(blocked).toContain("may already be sent");
	expect(blocked).toContain("check the transcript before retrying");
	expect(blocked).toContain("Send queued message again (may duplicate): possibly sent");
});
