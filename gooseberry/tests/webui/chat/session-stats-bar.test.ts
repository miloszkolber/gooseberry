import { expect, test } from "bun:test";
import type { SessionStats } from "@gooseberry/contracts";
import { formatTokens, usageParts } from "@/chat/session-stats-bar";

function stats(overrides: Partial<SessionStats> = {}): SessionStats {
	return {
		sessionId: "session",
		totalMessages: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		cost: 0,
		...overrides,
	};
}

test("usage formatting distinguishes reported zeroes from unavailable fields", () => {
	expect(usageParts(stats({ reported: { input: true } }))).toEqual(["↑0"]);
	expect(
		usageParts(
			stats({ tokens: { input: 1_500, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_500 } }),
		),
	).toEqual(["↑1.5k"]);
	expect(usageParts(stats({ reported: {} }))).toEqual([]);
	expect(formatTokens(2_500_000)).toBe("2.5M");
});
