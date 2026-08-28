import type { GitDiffScope } from "@gooseberry/contracts";
import { DOUBLE_CLICK_SETTLE_MS, projectRelativePath, tupleKey } from "../lib";
import {
	type ContentTab,
	selectDiffTabTargetRef,
	selectProjectAreaById,
	selectProjectAreaTick,
	type TabIntent,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { diffTabId, diffTabName } from "./changes-model";

function baseName(path: string): string {
	return path.split("/").pop() || path;
}

type ReadContentTab = Extract<ContentTab, { kind: "file" | "diff" }>;

function resourceIdentity(tab: ReadContentTab): string {
	return tab.kind === "diff" ? `diff:${tab.scope}:${tab.path}` : `file:${tab.path}`;
}

const inFlight = new Map<string, { intent: TabIntent; claimPreview: boolean }>();
const previewEpochByProjectArea = new Map<string, number>();

function previewEpoch(projectAreaId: string, intent: TabIntent): number {
	if (intent !== "preview") return previewEpochByProjectArea.get(projectAreaId) ?? 0;
	const next = (previewEpochByProjectArea.get(projectAreaId) ?? 0) + 1;
	previewEpochByProjectArea.set(projectAreaId, next);
	return next;
}

async function openReadTab<T>(
	projectAreaId: string,
	id: string,
	identity: string,
	intent: TabIntent,
	read: () => Promise<T>,
	build: (payload: T, loadedTick: number) => ContentTab,
): Promise<void> {
	const store = useAppStore.getState();
	if (store.removedProjectAreaIds[projectAreaId]) return;
	const pending = inFlight.get(id);
	if (pending) {
		pending.claimPreview ||= intent === "preview";
		if (intent === "keep") pending.intent = "keep";
		return;
	}
	const epoch = previewEpoch(projectAreaId, intent);
	const flight = { intent, claimPreview: intent === "preview", epoch };
	inFlight.set(id, flight);
	try {
		if (intent === "preview")
			await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_SETTLE_MS));
		if (
			flight.intent === "preview" &&
			flight.epoch !== (previewEpochByProjectArea.get(projectAreaId) ?? 0)
		) {
			return;
		}
		const latest = useAppStore.getState();
		const cached = (latest.tabsByProjectArea[projectAreaId] ?? []).find(
			(tab) => (tab.kind === "file" || tab.kind === "diff") && resourceIdentity(tab) === identity,
		);
		if (cached) {
			latest.openTab(
				cached,
				flight.intent,
				flight.intent === "keep" && flight.claimPreview ? { claimPreview: true } : undefined,
			);
			return;
		}
		const loadedTick = selectProjectAreaTick(latest, projectAreaId);
		const payload = await read();
		const current = useAppStore.getState();
		if (
			flight.intent === "preview" &&
			flight.epoch !== (previewEpochByProjectArea.get(projectAreaId) ?? 0)
		) {
			return;
		}
		const installed = (current.tabsByProjectArea[projectAreaId] ?? []).find(
			(tab) => (tab.kind === "file" || tab.kind === "diff") && resourceIdentity(tab) === identity,
		);
		current.openTab(
			installed ?? build(payload, loadedTick),
			flight.intent,
			flight.intent === "keep" && flight.claimPreview ? { claimPreview: true } : undefined,
		);
	} catch {
		// Reads are best effort. The activity panel retains the source row so users can retry.
	} finally {
		inFlight.delete(id);
	}
}

export function openFileInTab(
	projectAreaId: string,
	reported: string,
	intent: TabIntent,
	_requestedNavigation?: unknown,
	root?: string,
): Promise<void> {
	const projectArea = selectProjectAreaById(useAppStore.getState(), projectAreaId);
	const selectedRoot = root ?? projectArea?.root ?? "";
	const path = projectRelativePath(reported, selectedRoot);
	const id = tupleKey("file", projectAreaId, path);
	return openReadTab(
		projectAreaId,
		id,
		`file:${path}`,
		intent,
		() =>
			getTransport().request("fs.readFile", { projectId: projectAreaId, root: selectedRoot, path }),
		({ content }, loadedTick) => ({
			kind: "file",
			id,
			projectAreaId,
			root: selectedRoot,
			path,
			name: baseName(path),
			content,
			loadedTick,
		}),
	);
}

export function openDiffInTab(
	projectAreaId: string,
	scope: GitDiffScope,
	path: string,
	intent: TabIntent,
	_requestedNavigation?: unknown,
	repository?: string,
): Promise<void> {
	const selectedRepository = repository ?? "";
	const canonicalPath = projectRelativePath(path, selectedRepository);
	const id = diffTabId(projectAreaId, scope, canonicalPath);
	const target = selectDiffTabTargetRef(useAppStore.getState(), { projectAreaId, scope });
	return openReadTab(
		projectAreaId,
		id,
		`diff:${scope}:${canonicalPath}`,
		intent,
		() =>
			getTransport().request("git.diffFile", {
				projectId: projectAreaId,
				repository: selectedRepository,
				path: canonicalPath,
				scope,
			}),
		({ original, modified }, loadedTick) => ({
			kind: "diff",
			id,
			projectAreaId,
			repository: selectedRepository,
			path: canonicalPath,
			scope,
			name: diffTabName(scope, canonicalPath),
			original,
			modified,
			loadedTick,
			loadedTarget: target,
		}),
	);
}
