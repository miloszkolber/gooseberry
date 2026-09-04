import { expect, test } from "bun:test";
import type { ProviderStatus } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	invalidateProviderReadiness,
	ProviderCard,
	readinessStatusText,
	settleProviderReadiness,
} from "@/settings/sections/providers-settings";

const provider: ProviderStatus = {
	id: "openai",
	name: "OpenAI",
	configured: true,
	modelCount: 1,
	availableModelCount: 1,
	acp: true,
};

test("provider cards gate readiness controls and expose safe status states", () => {
	const acpMarkup = renderToStaticMarkup(
		<ProviderCard provider={provider} busy={false} onSignIn={() => {}} onSignOut={() => {}} />,
	);
	expect(acpMarkup).toContain("Check readiness for OpenAI");
	expect(acpMarkup).toContain("Check readiness");
	expect(acpMarkup).toContain("readiness not checked");
	expect(readinessStatusText("checking")).toBe("Checking readiness…");
	expect(readinessStatusText("ready")).toBe("Ready");
	expect(readinessStatusText("issue")).toBe("Ready with an issue");
	expect(readinessStatusText("not-ready")).toBe("Not ready");
	expect(readinessStatusText("failed")).toBe("Couldn't check readiness.");
	const genericMarkup = renderToStaticMarkup(
		<ProviderCard
			provider={{ ...provider, id: "other", name: "Other", acp: false }}
			busy={false}
			onSignIn={() => {}}
			onSignOut={() => {}}
		/>,
	);
	expect(genericMarkup).not.toContain("Check readiness");
	const unavailableMarkup = renderToStaticMarkup(
		<ProviderCard
			provider={{ ...provider, available: false, detail: "Inventory failed" }}
			busy={false}
			onSignIn={() => {}}
			onSignOut={() => {}}
		/>,
	);
	expect(unavailableMarkup).toContain("runtime unavailable");
	expect(unavailableMarkup).toContain("Inventory failed");
	expect(unavailableMarkup).not.toContain("runtime available");
});

test("a deferred readiness result cannot survive provider replacement or logout invalidation", () => {
	const checking = { revision: 4, status: "checking" as const };
	const afterStatusReplacement = invalidateProviderReadiness(checking);
	expect(settleProviderReadiness(afterStatusReplacement, 4, "ready")).toEqual({
		revision: 5,
		status: null,
	});
	const afterLogout = invalidateProviderReadiness(afterStatusReplacement);
	expect(settleProviderReadiness(afterLogout, 5, "failed")).toEqual({
		revision: 6,
		status: null,
	});
});
