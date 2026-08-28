import type { GitDiffScope } from "@gooseberry/contracts";
import { CodedError } from "@gooseberry/shared/codedError";
import { gitAsync } from "./git-exec";

export interface DiffRange {
	listPrefix: string[];
	listRevs: string[];
	untracked: boolean;
	originalRef: string | null;
	modifiedRef: string | null;
}

const OID = /^[0-9a-f]{4,64}$/;

export async function resolveCommitOid(
	repositoryPath: string,
	ref: string,
): Promise<string | null> {
	const out = await gitAsync(repositoryPath, [
		"rev-parse",
		"--verify",
		"--quiet",
		"--end-of-options",
		`${ref}^{commit}`,
	]);
	return out.ok && out.out ? out.out : null;
}

export async function resolveDiffRange(
	repository: string,
	scope: GitDiffScope = { kind: "branch" },
): Promise<DiffRange> {
	if (scope.kind === "uncommitted" || scope.kind === "branch") {
		return {
			listPrefix: ["diff"],
			listRevs: ["HEAD"],
			untracked: true,
			originalRef: "HEAD",
			modifiedRef: null,
		};
	}
	if (scope.kind === "pinned") {
		if (!OID.test(scope.baseRef)) throw new Error(`Not a commit id: ${scope.baseRef}`);
		const resolved = await gitAsync(repository, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.baseRef}^{commit}`,
		]);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.baseRef}`);
		return {
			listPrefix: ["diff"],
			listRevs: [resolved.out],
			untracked: true,
			originalRef: resolved.out,
			modifiedRef: null,
		};
	}
	if (scope.kind === "commit") {
		if (!OID.test(scope.sha)) throw new Error(`Not a commit id: ${scope.sha}`);
		const resolved = await gitAsync(repository, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${scope.sha}^{commit}`,
		]);
		if (!resolved.ok || !resolved.out)
			throw new CodedError("UNKNOWN_COMMIT", `Unknown commit: ${scope.sha}`);
		const sha = resolved.out;
		const parent = await gitAsync(repository, [
			"rev-parse",
			"--verify",
			"--quiet",
			`${sha}^^{commit}`,
		]);
		if (!parent.ok || !parent.out) {
			return {
				listPrefix: ["show", "--format="],
				listRevs: [sha],
				untracked: false,
				originalRef: null,
				modifiedRef: sha,
			};
		}
		return {
			listPrefix: ["diff"],
			listRevs: [parent.out, sha],
			untracked: false,
			originalRef: parent.out,
			modifiedRef: sha,
		};
	}
	throw new Error("Unsupported Git diff scope");
}

export function changedFileArgs(
	range: DiffRange,
	mode: "--name-status" | "--numstat" | "--shortstat",
): string[] {
	return [
		...range.listPrefix,
		"--no-ext-diff",
		"--no-textconv",
		mode,
		"--end-of-options",
		...range.listRevs,
		"--",
	];
}
