import { expect, test } from "bun:test";
import type { GitBranchRef, GitCommit, GitHead } from "@gooseberry/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { branchName, diffTabId, scopeKey, scopeLabel } from "@/files/changes-model";
import { BranchPicker, CommitPicker } from "@/files/git-scope-menu";

const commit: GitCommit = {
	sha: "a".repeat(40),
	shortSha: "aaaaaaa",
	subject: "An actual commit",
	author: "A contributor",
	committedAt: "2026-08-30T00:00:00Z",
};
const main: GitBranchRef = { ref: "refs/heads/main", name: "main" };
const remoteMain: GitBranchRef = { ref: "refs/remotes/origin/main", name: "origin/main" };
const detached: GitHead = { kind: "detached", oid: "b".repeat(40) };

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

test("branch selection distinguishes unavailable catalogs and validates its selection", () => {
	const render = (
		catalog: Parameters<typeof BranchPicker>[0]["catalog"],
		initialSelection = "",
		head: GitHead = detached,
	) =>
		renderToStaticMarkup(
			<BranchPicker
				catalog={catalog}
				head={head}
				initialSelection={initialSelection}
				onSelect={() => {}}
				onRetry={() => {}}
			/>,
		);
	expect(render(null)).toContain("Loading branches…");
	const failure = render({ error: "Git failed" });
	expect(failure).toContain('role="alert"');
	expect(failure).toContain("Retry");
	expect(render({ branches: [], truncated: false })).toContain("No branches found.");
	expect(render({ branches: [main], truncated: false }, "", { kind: "unborn" })).toContain(
		"Create the first commit before comparing branches.",
	);
	const attached = render({ branches: [main, remoteMain], truncated: false }, "", {
		kind: "branch",
		name: "main",
	});
	expect(attached).toContain("main (current)");
	expect(attached).toContain("origin/main");

	const stale = render({ branches: [remoteMain], truncated: false }, "refs/heads/deleted");
	expect(stale).toMatch(/<button[^>]*disabled=""[^>]*>Compare branch<\/button>/);
	const selected = render({ branches: [remoteMain], truncated: true }, remoteMain.ref);
	expect(selected).not.toMatch(/<button[^>]*disabled=""[^>]*>Compare branch<\/button>/);
	expect(selected).toContain("Some branches are not shown.");
});

test("review targets distinguish scopes, commits, repositories and projects", () => {
	const scope = { kind: "commit", sha: commit.sha } as const;
	const targets = [
		diffTabId("one", "/first", scope, "file.txt"),
		diffTabId("two", "/first", scope, "file.txt"),
		diffTabId("one", "/second", scope, "file.txt"),
		diffTabId("one", "/first", { kind: "commit", sha: "b".repeat(40) }, "file.txt"),
		diffTabId("one", "/first", { kind: "pinned", baseRef: commit.sha }, "file.txt"),
		diffTabId("one", "/first", { kind: "branch", baseRef: main.ref }, "file.txt"),
		diffTabId("one", "/first", { kind: "branch", baseRef: remoteMain.ref }, "file.txt"),
	];
	expect(new Set(targets).size).toBe(targets.length);
	expect(scopeKey(scope)).not.toBe(scopeKey({ kind: "pinned", baseRef: commit.sha }));
	expect(scopeLabel(scope)).toBe("Commit aaaaaaa");
	expect(scopeLabel({ kind: "pinned", baseRef: commit.sha })).toBe("Since aaaaaaa");
	expect(scopeLabel({ kind: "branch", baseRef: remoteMain.ref })).toBe("Changes from origin/main");
	expect(branchName("refs/heads/release\u202eexe.txt")).toBe("releaseexe.txt");
});
