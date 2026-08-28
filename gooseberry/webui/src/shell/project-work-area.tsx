import { MessageSquarePlus, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "../components/error-boundary";
import { ChangesPanel } from "../panels/changes-panel";
import { DiffPane } from "../panels/diff-pane";
import { FilePane } from "../panels/file-pane";
import { FileTree } from "../panels/file-tree";
import { ProjectTree } from "../panels/project-tree";
import {
	type ContentTab,
	selectActiveContentTab,
	selectContextProject,
	selectProjectAreaById,
	toast,
	useAppStore,
} from "../store";
import { createAgentSession, errorText } from "../transport";
import {
	hydrateChatResource,
	useChatLocationReconciliation,
	useProjectAreaChatCatalogReconciliation,
} from "./chat-reconciliation";
import { ProjectChatHistory } from "./project-chat-history";

const ChatView = lazy(() => import("../chat/chat-view"));
const EMPTY_TABS: ContentTab[] = [];
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

export function ProjectWorkArea({ projectAreaId }: { projectAreaId: string }) {
	const projectArea = useAppStore((state) => selectProjectAreaById(state, projectAreaId));
	const contextProject = useAppStore(selectContextProject);
	const contentTabs = useAppStore((state) => state.tabsByProjectArea[projectAreaId] ?? EMPTY_TABS);
	const previewTabId = useAppStore((state) => state.previewTabByProjectArea[projectAreaId] ?? null);
	const activeTab = useAppStore((state) => selectActiveContentTab(state, projectAreaId));
	const sessions = useAppStore((state) => state.sessions);
	const requestedActivity = useAppStore(
		(state) => state.activeActivityByProjectArea[projectAreaId] ?? "files",
	);
	const [activity, setActivity] = useState<Activity>(requestedActivity);

	useProjectAreaChatCatalogReconciliation(projectAreaId);
	useChatLocationReconciliation(projectAreaId);

	useEffect(() => {
		setActivity(requestedActivity);
	}, [requestedActivity]);

	const startChat = useCallback(() => {
		void createAgentSession({
			projectId: projectAreaId,
			...(projectArea?.root ? { cwd: projectArea.root } : {}),
		})
			.then(({ sessionId, model, thinkingLevel }) => {
				useAppStore.getState().openChatSession(projectAreaId, sessionId, model, thinkingLevel);
			})
			.catch((error) => {
				if (!useAppStore.getState().removedProjectAreaIds[projectAreaId]) {
					toast.error(errorText(error), "Couldn't start the chat");
				}
			});
	}, [projectArea, projectAreaId]);

	const renderContent = useCallback(
		(tab: ContentTab | null) => {
			if (!tab) {
				return (
					<div
						data-testid="project-ready"
						className="flex h-full flex-col items-center justify-center gap-xs px-lg text-center"
					>
						<span className="tr-text-eyebrow text-text-muted">Project ready</span>
						{projectArea ? (
							<>
								<h2 className="max-w-full truncate tr-title-entity text-text-default">
									{contextProject?.name ?? projectArea.name}
								</h2>
								<p className="max-w-full truncate tr-text-metadata text-text-muted">
									{projectArea.root}
								</p>
							</>
						) : null}
						<p className="mt-xs tr-text-ui text-text-muted">
							Files, chats, and discovered repositories are scoped to this project.
						</p>
						<button
							type="button"
							data-testid="start-chat"
							onClick={startChat}
							className="mt-xs flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-md py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
						>
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
							<button
								type="button"
								className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered"
								onClick={() => void hydrateChatResource(projectAreaId, tab.sessionId)}
							>
								Retry
							</button>
						</div>
					);
				}
				return (
					<ErrorBoundary label="chat" resetKeys={[projectAreaId, tab.id]}>
						<Suspense fallback={<MissingResource label="chat" />}>
							<ChatView sessionId={tab.sessionId} projectAreaId={projectAreaId} />
						</Suspense>
					</ErrorBoundary>
				);
			}
			return (
				<ErrorBoundary label="preview" resetKeys={[projectAreaId, tab.id]}>
					<Suspense fallback={<MissingResource label="preview" />}>
						{tab.kind === "file" ? <FilePane tab={tab} /> : <DiffPane tab={tab} />}
					</Suspense>
				</ErrorBoundary>
			);
		},
		[contextProject, sessions, startChat, projectArea, projectAreaId],
	);

	const renderActivity = () =>
		activity === "files" ? (
			<FileTree key={projectAreaId} projectAreaId={projectAreaId} />
		) : (
			<ChangesPanel projectAreaId={projectAreaId} />
		);

	return (
		<div data-testid="project-work-area" className="flex h-full min-h-0 min-w-0">
			<aside
				data-testid="left-nav"
				tabIndex={-1}
				className="w-[clamp(12rem,20vw,16rem)] shrink-0 overflow-auto border-border-default border-r bg-container-sidebar-bg p-md outline-none"
			>
				<ProjectTree />
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex min-h-10 shrink-0 items-center gap-xs border-border-default border-b bg-container-header-bg px-xs">
					<div
						className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto"
						role="tablist"
						aria-label="Open tabs"
					>
						{contentTabs.map((tab) => (
							<div
								key={tab.id}
								data-testid="content-tab"
								data-kind={tab.kind}
								data-active={activeTab?.id === tab.id ? "true" : "false"}
								data-preview={previewTabId === tab.id ? "true" : "false"}
								className="flex shrink-0 items-center border-border-default border-r"
							>
								<button
									type="button"
									role="tab"
									aria-selected={activeTab?.id === tab.id}
									className={`max-w-[12rem] truncate px-sm py-sm tr-text-ui text-text-muted hover:text-text-default aria-selected:bg-control-bg-selected aria-selected:text-text-default ${previewTabId === tab.id ? "italic" : "not-italic"}`}
									onClick={() => useAppStore.getState().setActiveTab(tab.id, "keep")}
								>
									{tab.name}
								</button>
								<button
									type="button"
									data-testid="content-tab-close"
									aria-label={`Close ${tab.name}`}
									className="px-xs text-text-muted hover:text-text-default"
									onClick={() =>
										tab.kind === "chat"
											? useAppStore
													.getState()
													.closeChatToHistory(tab.sessionId, projectAreaId, false)
											: useAppStore.getState().closeTab(tab.id, false, projectAreaId)
									}
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
					<ProjectChatHistory projectAreaId={projectAreaId} />
					<button
						type="button"
						data-testid="new-chat"
						aria-label="New chat"
						title="New chat"
						className="flex shrink-0 items-center gap-xs rounded-[var(--radius-sm)] px-sm py-xs text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						onClick={startChat}
					>
						<MessageSquarePlus className="size-4" />
					</button>
				</div>
				<div className="flex min-h-0 flex-1">
					<main
						data-testid="primary-content"
						role="tabpanel"
						aria-label={activeTab?.name ?? "ProjectArea content"}
						className="min-h-0 min-w-0 flex-1 bg-container-content-bg"
					>
						{renderContent(activeTab)}
					</main>
					<aside className="flex w-[clamp(14rem,26vw,22rem)] min-h-0 shrink-0 flex-col border-border-default border-l bg-container-sidebar-bg">
						<div
							id="activity-tabs"
							data-testid="activity-tabs"
							tabIndex={-1}
							role="tablist"
							aria-label="ProjectArea activities"
							className="flex shrink-0 border-border-default border-b"
						>
							{(["files", "changes"] as const).map((item) => (
								<button
									key={item}
									type="button"
									data-testid={`tab-${item}`}
									role="tab"
									aria-selected={activity === item}
									className="flex-1 px-sm py-sm tr-text-ui text-text-muted hover:text-text-default aria-selected:bg-control-bg-selected aria-selected:text-text-default"
									onClick={() => {
										setActivity(item);
										useAppStore.getState().setActiveActivity(projectAreaId, item);
									}}
								>
									{activityLabel(item)}
								</button>
							))}
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							<ErrorBoundary label={`${activity} activity`} resetKeys={[projectAreaId, activity]}>
								{renderActivity()}
							</ErrorBoundary>
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}
