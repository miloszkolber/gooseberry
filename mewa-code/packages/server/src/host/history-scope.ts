import { isAbsolute, relative } from "node:path";
import type { HistoryScope, Project } from "@mewa-code/contracts";
import type { ProjectSessionRecord } from "../persistence";

function isWithin(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function buildHistoryScope(
	scope: HistoryScope,
	projects: Project[],
	_records: ProjectSessionRecord[],
): {
	filter: (cwd: string, sessionId: string) => boolean;
	labels: (cwd: string) => { projectId?: string };
} {
	const project =
		scope.kind === "project"
			? projects.find((candidate) => candidate.id === scope.projectId)
			: undefined;
	const filter =
		scope.kind === "all"
			? () => true
			: scope.kind === "chat"
				? (_cwd: string, sessionId: string) => sessionId === scope.sessionId
				: project
					? (cwd: string) => project.roots.some((root) => isWithin(root, cwd))
					: () => false;
	const labels = (cwd: string) => {
		const owner = projects.find((candidate) => candidate.roots.some((root) => isWithin(root, cwd)));
		return owner ? { projectId: owner.id } : {};
	};
	return { filter, labels };
}
