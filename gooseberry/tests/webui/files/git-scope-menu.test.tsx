import { expect, test } from "bun:test";
import type { GitCommit } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { diffTabId, scopeKey, scopeLabel } from "@/files/changes-model";
import { CommitPicker } from "@/files/git-scope-menu";

const commit: GitCommit = {
	sha: "a".repeat(40),
	shortSha: "aaaaaaa",
	subject: "An actual commit",
	author: "A contributor",
	committedAt: "2026-08-30T00:00:00Z",
};

test("commit selection distinguishes loading, failure and empty history", () => {
	const render = (history: Parameters<typeof CommitPicker>[0]["history"]) =>
		renderToStaticMarkup(
			<CommitPicker history={history} initialSelection="" onSelect={() => {}} onRetry={() => {}} />,
		);
	expect(render(null)).toContain("Loading commits…");
	expect(render(null)).not.toContain("No commits yet");
	const failure = render({ error: "Git failed" });
	expect(failure).toContain('role="alert"');
	expect(failure).toContain("Retry");
	expect(failure).not.toContain("No commits yet");
	expect(render({ commits: [] })).toContain("No commits yet.");
});

test("commit actions require a selection that still belongs to the current catalog", () => {
	const render = (initialSelection: string) =>
		renderToStaticMarkup(
			<CommitPicker
				history={{ commits: [commit] }}
				initialSelection={initialSelection}
				onSelect={() => {}}
				onRetry={() => {}}
			/>,
		);
	for (const selection of ["", "removed-commit"]) {
		expect(render(selection).match(/disabled=""/g)).toHaveLength(3);
	}
	const selected = render(commit.sha);
	expect(selected.match(/disabled=""/g)).toHaveLength(1);
	expect(selected).toContain("View commit");
	expect(selected).toContain("Compare with working tree");
});

test("review targets distinguish scopes, commits, repositories and projects", () => {
	const scope = { kind: "commit", sha: commit.sha } as const;
	const targets = [
		diffTabId("one", "/first", scope, "file.txt"),
		diffTabId("two", "/first", scope, "file.txt"),
		diffTabId("one", "/second", scope, "file.txt"),
		diffTabId("one", "/first", { kind: "commit", sha: "b".repeat(40) }, "file.txt"),
		diffTabId("one", "/first", { kind: "pinned", baseRef: commit.sha }, "file.txt"),
	];
	expect(new Set(targets).size).toBe(targets.length);
	expect(scopeKey(scope)).not.toBe(scopeKey({ kind: "pinned", baseRef: commit.sha }));
	expect(scopeLabel(scope)).toBe("Commit aaaaaaa");
	expect(scopeLabel({ kind: "pinned", baseRef: commit.sha })).toBe("Since aaaaaaa");
});
