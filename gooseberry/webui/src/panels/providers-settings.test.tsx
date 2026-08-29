import { expect, test } from "bun:test";
import type { ProviderStatus } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import {
	invalidateProviderReadiness,
	ProviderCard,
	readinessStatusText,
	settleProviderReadiness,
} from "./providers-settings";

const provider: ProviderStatus = {
	id: "openai",
	name: "OpenAI",
	configured: true,
	modelCount: 1,
	availableModelCount: 1,
	acp: true,
};

test("ACP providers expose an accessible readiness control and all safe status states", () => {
	const markup = renderToStaticMarkup(
		<ProviderCard provider={provider} busy={false} onSignIn={() => {}} onSignOut={() => {}} />,
	);
	expect(markup).toContain("Check readiness for OpenAI");
	expect(markup).toContain("Check readiness");
	expect(readinessStatusText("checking")).toBe("Checking readiness…");
	expect(readinessStatusText("ready")).toBe("Ready");
	expect(readinessStatusText("issue")).toBe("Ready with an issue");
	expect(readinessStatusText("not-ready")).toBe("Not ready");
	expect(readinessStatusText("failed")).toBe("Couldn't check readiness.");
});

test("non-ACP provider cards do not offer readiness checks", () => {
	const markup = renderToStaticMarkup(
		<ProviderCard
			provider={{ ...provider, id: "other", name: "Other", acp: false }}
			busy={false}
			onSignIn={() => {}}
			onSignOut={() => {}}
		/>,
	);
	expect(markup).not.toContain("Check readiness");
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
