import { GitBranch, MessageSquarePlus, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ChangesPanel } from "../panels/ChangesPanel";
import { DiffPane } from "../panels/DiffPane";
import { FilePane } from "../panels/FilePane";
import { FileTree } from "../panels/FileTree";
import { ProjectTree } from "../panels/ProjectTree";
import {
	type EditorTab,
	isDefaultWorkspace,
	isExternalWorkspace,
	selectActiveEditorTab,
	selectContextProject,
	selectWorkspaceById,
	toast,
	useAppStore,
} from "../store";
import { createSessionWithSkillBaseline, errorText } from "../transport";
import {
	hydrateChatResource,
	useChatLocationReconciliation,
	useWorkspaceChatCatalogReconciliation,
} from "./chatReconciliation";
import { WorkspaceChatHistory } from "./WorkspaceChatHistory";

const ChatView = lazy(() => import("../chat/ChatView"));
const EMPTY_TABS: EditorTab[] = [];
type Activity = "files" | "changes";

function MissingResource({ label }: { label: string }) {
	return (
		<div className="flex h-full items-center justify-center px-lg text-center tr-text-ui text-text-muted">
			Restoring {label}…
		</div>
	);
}

function activityLabel(activity: Activity): string {
	return activity.slice(0, 1).toUpperCase() + activity.slice(1);
}

export function WorkspaceWorkbench({ workspaceId }: { workspaceId: string }) {
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const contextProject = useAppStore(selectContextProject);
	const editorTabs = useAppStore((state) => state.tabsByWorkspace[workspaceId] ?? EMPTY_TABS);
	const previewTabId = useAppStore((state) => state.previewTabByWorkspace[workspaceId] ?? null);
	const activeTab = useAppStore((state) => selectActiveEditorTab(state, workspaceId));
	const sessions = useAppStore((state) => state.sessions);
	const requestedActivity = useAppStore(
		(state) => state.activeActivityByWorkspace[workspaceId] ?? "files",
	);
	const [activity, setActivity] = useState<Activity>(requestedActivity);

	useWorkspaceChatCatalogReconciliation(workspaceId);
	useChatLocationReconciliation(workspaceId);

	useEffect(() => {
		setActivity(requestedActivity);
	}, [requestedActivity]);

	const startChat = useCallback(() => {
		void createSessionWithSkillBaseline({ workspaceId })
			.then(({ result: { sessionId, model, thinkingLevel }, syncedTick }) => {
				useAppStore
					.getState()
					.openChatSession(workspaceId, sessionId, model, thinkingLevel, syncedTick);
			})
			.catch((error) => {
				if (!useAppStore.getState().removedWorkspaceIds[workspaceId]) {
					toast.error(errorText(error), "Couldn't start the chat");
				}
			});
	}, [workspaceId]);

	const renderEditor = useCallback(
		(tab: EditorTab | null) => {
			if (!tab) {
				const isDefault = workspace != null && isDefaultWorkspace(workspace);
				const isExternal = workspace != null && isExternalWorkspace(workspace);
				return (
					<div data-testid="workspace-ready" className="flex h-full flex-col items-center justify-center gap-xs px-lg text-center">
						<span className="tr-text-eyebrow text-text-muted">
							{isDefault ? "Default workspace" : isExternal ? "Existing worktree" : "Workspace ready"}
						</span>
						{workspace ? (
							<>
								<h2 className="max-w-full truncate tr-title-entity text-text-default">
									{isDefault ? (contextProject?.name ?? workspace.name) : workspace.name}
								</h2>
								<p className="flex max-w-full items-center gap-xs tr-text-metadata text-text-muted">
									<GitBranch className="size-3.5 shrink-0" />
									<span className="truncate">{workspace.branch}</span>
								</p>
							</>
						) : null}
						<p className="mt-xs tr-text-ui text-text-muted">
							Files, chats, and changes are scoped to this workspace.
						</p>
						<button type="button" data-testid="start-chat" onClick={startChat} className="mt-xs flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-md py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered">
							<MessageSquarePlus className="size-4" /> New chat
						</button>
					</div>
				);
			}
			if (tab.kind === "chat") {
				if (!sessions[tab.sessionId]) {
					return (
						<div className="flex h-full flex-col items-center justify-center gap-sm">
							<MissingResource label="chat" />
							<button type="button" className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered" onClick={() => void hydrateChatResource(workspaceId, tab.sessionId)}>Retry</button>
						</div>
					);
				}
				return (
					<ErrorBoundary label="chat" resetKeys={[workspaceId, tab.id]}>
						<Suspense fallback={<MissingResource label="chat" />}>
							<ChatView sessionId={tab.sessionId} workspaceId={workspaceId} />
						</Suspense>
					</ErrorBoundary>
				);
			}
			return (
				<ErrorBoundary label="preview" resetKeys={[workspaceId, tab.id]}>
					<Suspense fallback={<MissingResource label="preview" />}>
						{tab.kind === "file" ? <FilePane tab={tab} /> : <DiffPane tab={tab} />}
					</Suspense>
				</ErrorBoundary>
			);
		},
		[contextProject, sessions, startChat, workspace, workspaceId],
	);

	const renderActivity = () =>
		activity === "files" ? (
			<FileTree key={workspaceId} workspaceId={workspaceId} />
		) : (
			<ChangesPanel workspaceId={workspaceId} />
		);

	return (
		<div data-testid="workspace-workbench" className="flex h-full min-h-0 min-w-0">
			<aside data-testid="left-nav" tabIndex={-1} className="w-[clamp(12rem,20vw,16rem)] shrink-0 overflow-auto border-border-default border-r bg-container-sidebar-bg p-md outline-none">
				<ProjectTree />
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex min-h-10 shrink-0 items-center gap-xs border-border-default border-b bg-container-header-bg px-xs">
					<div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto" role="tablist" aria-label="Open tabs">
						{editorTabs.map((tab) => (
							<div key={tab.id} data-testid="editor-tab" data-kind={tab.kind} data-active={activeTab?.id === tab.id ? "true" : "false"} data-preview={previewTabId === tab.id ? "true" : "false"} className="flex shrink-0 items-center border-border-default border-r">
								<button type="button" role="tab" aria-selected={activeTab?.id === tab.id} className={`max-w-[12rem] truncate px-sm py-sm tr-text-ui text-text-muted hover:text-text-default aria-selected:bg-control-bg-selected aria-selected:text-text-default ${previewTabId === tab.id ? "italic" : "not-italic"}`} onClick={() => useAppStore.getState().setActiveTab(tab.id, "keep")}>{tab.name}</button>
								<button type="button" data-testid="editor-tab-close" aria-label={`Close ${tab.name}`} className="px-xs text-text-muted hover:text-text-default" onClick={() => tab.kind === "chat" ? useAppStore.getState().closeChatToHistory(tab.sessionId, workspaceId, false) : useAppStore.getState().closeTab(tab.id, false, workspaceId)}><X className="size-3" /></button>
							</div>
						))}
					</div>
					<WorkspaceChatHistory workspaceId={workspaceId} />
					<button type="button" data-testid="new-chat" aria-label="New chat" title="New chat" className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-xs text-text-muted hover:bg-control-bg-hovered hover:text-text-default" onClick={startChat}><MessageSquarePlus className="size-4" /></button>
				</div>
				<div className="flex min-h-0 flex-1">
					<main data-testid="primary-content" role="tabpanel" aria-label={activeTab?.name ?? "Workspace content"} className="min-h-0 min-w-0 flex-1 bg-container-content-bg">{renderEditor(activeTab)}</main>
					<aside className="flex w-[clamp(14rem,26vw,22rem)] min-h-0 shrink-0 flex-col border-border-default border-l bg-container-sidebar-bg">
						<div id="activity-tabs" data-testid="activity-tabs" tabIndex={-1} role="tablist" aria-label="Workspace activities" className="flex shrink-0 border-border-default border-b">
							{(["files", "changes"] as const).map((item) => (
								<button key={item} type="button" data-testid={`tab-${item}`} role="tab" aria-selected={activity === item} className="flex-1 px-sm py-sm tr-text-ui text-text-muted hover:text-text-default aria-selected:bg-control-bg-selected aria-selected:text-text-default" onClick={() => { setActivity(item); useAppStore.getState().setActiveActivity(workspaceId, item); }}>{activityLabel(item)}</button>
							))}
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							<ErrorBoundary label={`${activity} activity`} resetKeys={[workspaceId, activity]}>{renderActivity()}</ErrorBoundary>
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}
