import type { GitDiffScope } from "@mewa-code/contracts";
import { DOUBLE_CLICK_SETTLE_MS, projectRelativePath, tupleKey } from "../lib";
import {
	type EditorTab,
	selectDiffTabTargetRef,
	selectWorkspaceById,
	selectWorkspaceTick,
	type TabIntent,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";
import { diffTabId, diffTabName } from "./changesModel";

function baseName(path: string): string {
	return path.split("/").pop() || path;
}

type ReadEditorTab = Extract<EditorTab, { kind: "file" | "diff" }>;

function resourceIdentity(tab: ReadEditorTab): string {
	return tab.kind === "diff" ? `diff:${tab.scope}:${tab.path}` : `file:${tab.path}`;
}

const inFlight = new Map<string, { intent: TabIntent; claimPreview: boolean }>();
const previewEpochByWorkspace = new Map<string, number>();

function previewEpoch(workspaceId: string, intent: TabIntent): number {
	if (intent !== "preview") return previewEpochByWorkspace.get(workspaceId) ?? 0;
	const next = (previewEpochByWorkspace.get(workspaceId) ?? 0) + 1;
	previewEpochByWorkspace.set(workspaceId, next);
	return next;
}

async function openReadTab<T>(
	workspaceId: string,
	id: string,
	identity: string,
	intent: TabIntent,
	read: () => Promise<T>,
	build: (payload: T, loadedTick: number) => EditorTab,
): Promise<void> {
	const store = useAppStore.getState();
	if (store.removedWorkspaceIds[workspaceId]) return;
	const pending = inFlight.get(id);
	if (pending) {
		pending.claimPreview ||= intent === "preview";
		if (intent === "keep") pending.intent = "keep";
		return;
	}
	const epoch = previewEpoch(workspaceId, intent);
	const flight = { intent, claimPreview: intent === "preview", epoch };
	inFlight.set(id, flight);
	try {
		if (intent === "preview")
			await new Promise((resolve) => setTimeout(resolve, DOUBLE_CLICK_SETTLE_MS));
		if (
			flight.intent === "preview" &&
			flight.epoch !== (previewEpochByWorkspace.get(workspaceId) ?? 0)
		) {
			return;
		}
		const latest = useAppStore.getState();
		const cached = (latest.tabsByWorkspace[workspaceId] ?? []).find(
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
		const loadedTick = selectWorkspaceTick(latest, workspaceId);
		const payload = await read();
		const current = useAppStore.getState();
		if (
			flight.intent === "preview" &&
			flight.epoch !== (previewEpochByWorkspace.get(workspaceId) ?? 0)
		) {
			return;
		}
		const installed = (current.tabsByWorkspace[workspaceId] ?? []).find(
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
	workspaceId: string,
	reported: string,
	intent: TabIntent,
	_requestedNavigation?: unknown,
): Promise<void> {
	const path = projectRelativePath(
		reported,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = tupleKey("file", workspaceId, path);
	return openReadTab(
		workspaceId,
		id,
		`file:${path}`,
		intent,
		() => getTransport().request("fs.readFile", { workspaceId, path }),
		({ content }, loadedTick) => ({
			kind: "file",
			id,
			workspaceId,
			path,
			name: baseName(path),
			content,
			savedContent: content,
			dirty: false,
			loadedTick,
		}),
	);
}

export function openDiffInTab(
	workspaceId: string,
	scope: GitDiffScope,
	path: string,
	intent: TabIntent,
	_requestedNavigation?: unknown,
): Promise<void> {
	const canonicalPath = projectRelativePath(
		path,
		selectWorkspaceById(useAppStore.getState(), workspaceId)?.worktreePath,
	);
	const id = diffTabId(workspaceId, scope, canonicalPath);
	const target = selectDiffTabTargetRef(useAppStore.getState(), { workspaceId, scope });
	return openReadTab(
		workspaceId,
		id,
		`diff:${scope}:${canonicalPath}`,
		intent,
		() => getTransport().request("git.diffFile", { workspaceId, path: canonicalPath, scope }),
		({ original, modified }, loadedTick) => ({
			kind: "diff",
			id,
			workspaceId,
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
