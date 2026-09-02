import { expect, test } from "bun:test";
import type { RuntimeStatusReport } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemStatusReportView } from "@/settings/system-settings";

test("system status renders provenance, metrics and textual component states", () => {
	const report: RuntimeStatusReport = {
		application: {
			state: "ready",
			build: {
				version: "1.2.3",
				revision: "0123456789abcdef0123456789abcdef01234567",
			},
			process: {
				uptimeSeconds: 90_061,
				goroutines: 12,
				heapBytes: 8_388_608,
				gcCycles: 7,
			},
			requests: { total: 125, failures: 2, active: 1, averageMs: 4.5, maxMs: 123 },
		},
		agent: {
			state: "degraded",
			name: "goose",
			version: "1.48.0",
			detail: "Missing an optional capability.",
		},
		browser: {
			state: "unavailable",
			detail: "Browser service is unavailable.",
		},
	};

	const markup = renderToStaticMarkup(<SystemStatusReportView report={report} />);
	expect(markup).toContain('data-testid="system-card-application"');
	expect(markup).toContain('data-testid="system-card-agent"');
	expect(markup).toContain('data-testid="system-card-browser"');
	expect(markup).toContain("Ready");
	expect(markup).toContain("Degraded");
	expect(markup).toContain("Unavailable");
	expect(markup).toContain("1.2.3");
	expect(markup).toContain("0123456789ab");
	expect(markup).toContain("goose");
	expect(markup).toContain("Average");
	expect(markup).toContain("Maximum");
	expect(markup).toContain("Browser service is unavailable.");
});
