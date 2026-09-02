import { MessageSquarePlus, X } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { SessionLifecycleMenu } from "../../chat/session/session-lifecycle-controls";
import { ErrorBoundary } from "../../components/error-boundary";
import { errorText, getTransport } from "../../connection";
import { ChangesPanel } from "../../files/changes/changes-panel";
import { FileTree } from "../../files/tree/file-tree";
import {
	type ContentTab,
	selectActiveContentTab,
	selectContextProject,
	selectProjectAreaById,
	toast,
	useAppStore,
} from "../../store";
import {
	hydrateChatResource,
	useChatLocationReconciliation,
	useProjectAreaChatCatalogReconciliation,
} from "../navigation/chat-reconciliation";
import { ProjectChatHistory } from "../projects/project-chat-history";
import { ProjectTree } from "../projects/project-tree";

const ChatView = lazy(() => import("../../chat/chat-view"));
const loadDiffPane = () => import("../../files/changes/diff-pane");
const loadFilePane = () => import("../../files/tabs/file-pane");
const DiffPane = lazy(async () => ({ default: (await loadDiffPane()).DiffPane }));
const FilePane = lazy(async () => ({ default: (await loadFilePane()).FilePane }));
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

export function selectTabSessionStreaming(
	state: ReturnType<typeof useAppStore.getState>,
	projectAreaId: string,
): Record<string, boolean> {
	return Object.fromEntries(
		(state.tabsByProjectArea[projectAreaId] ?? EMPTY_TABS).flatMap((tab): [string, boolean][] => {
			if (tab.kind !== "chat") return [];
			const runtime = state.sessions[tab.sessionId];
			return runtime ? [[tab.sessionId, runtime.isStreaming]] : [];
		}),
	);
}

export function ProjectWorkArea({ projectAreaId }: { projectAreaId: string }) {
	const projectArea = useAppStore((state) => selectProjectAreaById(state, projectAreaId));
	const contextProject = useAppStore(selectContextProject);
	const contentTabs = useAppStore((state) => state.tabsByProjectArea[projectAreaId] ?? EMPTY_TABS);
	const previewTabId = useAppStore((state) => state.previewTabByProjectArea[projectAreaId] ?? null);
	const activeTab = useAppStore((state) => selectActiveContentTab(state, projectAreaId));
	const sessionStreaming = useAppStore(
		useShallow((state) => selectTabSessionStreaming(state, projectAreaId)),
	);
	const activity = useAppStore(
		(state) => state.activeActivityByProjectArea[projectAreaId] ?? "files",
	);
	const [mobilePane, setMobilePane] = useState<"projects" | "content" | "activity">("content");
	const showContent = useCallback(
		() => setMobilePane((pane) => (pane === "activity" ? "content" : pane)),
		[],
	);

	useProjectAreaChatCatalogReconciliation(projectAreaId);
	useChatLocationReconciliation(projectAreaId);

	const startChat = useCallback(() => {
		void getTransport()
			.request("session.create", {
				projectId: projectAreaId,
				...(projectArea?.root ? { cwd: projectArea.root } : {}),
			})
			.then(({ sessionId, model, thinkingLevel, commands, modes }) => {
				useAppStore
					.getState()
					.openChatSession(projectAreaId, sessionId, model, thinkingLevel, modes);
				useAppStore.getState().setCommands(sessionId, commands);
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
				if (!Object.hasOwn(sessionStreaming, tab.sessionId)) {
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
							<ChatView
								key={tab.sessionId}
								sessionId={tab.sessionId}
								projectAreaId={projectAreaId}
							/>
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
		[contextProject, sessionStreaming, startChat, projectArea, projectAreaId],
	);

	const prefetchTab = (tab: ContentTab) => {
		if (tab.kind === "file") void loadFilePane();
		else if (tab.kind === "diff") void loadDiffPane();
	};

	const renderActivity = () =>
		activity === "files" ? (
			<FileTree key={projectAreaId} projectAreaId={projectAreaId} onOpen={showContent} />
		) : (
			<ChangesPanel projectAreaId={projectAreaId} onOpen={showContent} />
		);

	return (
		<div
			data-testid="project-work-area"
			className="flex h-full min-h-0 min-w-0 flex-col lg:flex-row"
		>
			<nav
				aria-label="Mobile panes"
				className="flex shrink-0 border-border-default border-b bg-container-header-bg lg:hidden"
			>
				{(["projects", "content", "activity"] as const).map((pane) => (
					<button
						key={pane}
						type="button"
						aria-pressed={mobilePane === pane}
						onClick={() => setMobilePane(pane)}
						className="min-h-11 flex-1 px-sm tr-text-ui capitalize text-text-muted aria-pressed:bg-control-bg-selected aria-pressed:text-text-default"
					>
						{pane}
					</button>
				))}
			</nav>
			<aside
				data-testid="left-nav"
				tabIndex={-1}
				className={`${mobilePane === "projects" ? "block" : "hidden"} min-h-0 flex-1 overflow-auto bg-container-sidebar-bg p-md outline-none lg:block lg:w-[clamp(12rem,20vw,16rem)] lg:flex-none lg:border-border-default lg:border-r`}
			>
				<ProjectTree />
			</aside>
			<div
				className={`${mobilePane !== "projects" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col lg:flex`}
			>
				<div
					className={`${mobilePane === "content" ? "flex" : "hidden"} min-h-10 shrink-0 items-center gap-xs border-border-default border-b bg-container-header-bg px-xs lg:flex`}
				>
					<div
						className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto"
						role="toolbar"
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
									aria-pressed={activeTab?.id === tab.id}
									onMouseEnter={() => prefetchTab(tab)}
									onFocus={() => prefetchTab(tab)}
									className={`max-w-[12rem] truncate px-sm py-sm tr-text-ui text-text-muted hover:text-text-default aria-pressed:bg-control-bg-selected aria-pressed:text-text-default ${previewTabId === tab.id ? "italic" : "not-italic"}`}
									onClick={() => useAppStore.getState().setActiveTab(tab.id, "keep")}
								>
									{tab.name}
								</button>
								{tab.kind === "chat" ? (
									<SessionLifecycleMenu
										target={{
											projectId: projectAreaId,
											sessionId: tab.sessionId,
											title: tab.name,
										}}
										streaming={sessionStreaming[tab.sessionId] === true}
									/>
								) : null}
								<button
									type="button"
									data-testid="content-tab-close"
									aria-label={`Close ${tab.name}`}
									className="px-xs text-text-muted hover:text-text-default"
									onClick={() => {
										if (tab.kind === "chat") {
											useAppStore
												.getState()
												.closeChatToHistory(tab.sessionId, projectAreaId, false);
										} else useAppStore.getState().closeTab(tab.id, false, projectAreaId);
									}}
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
						aria-label={activeTab?.name ?? "ProjectArea content"}
						className={`${mobilePane === "content" ? "block" : "hidden"} min-h-0 min-w-0 flex-1 bg-container-content-bg lg:block`}
					>
						{renderContent(activeTab)}
					</main>
					<aside
						className={`${mobilePane === "activity" ? "flex" : "hidden"} min-h-0 flex-1 flex-col bg-container-sidebar-bg lg:flex lg:w-[clamp(14rem,26vw,22rem)] lg:flex-none lg:border-border-default lg:border-l`}
					>
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
									aria-controls="activity-panel"
									tabIndex={activity === item ? 0 : -1}
									data-activity={item}
									onKeyDown={(event) => {
										if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
										event.preventDefault();
										const next = item === "files" ? "changes" : "files";
										useAppStore.getState().setActiveActivity(projectAreaId, next);
										(
											event.currentTarget.parentElement?.querySelector(
												`[data-activity="${next}"]`,
											) as HTMLElement | null
										)?.focus();
									}}
									className="min-h-11 flex-1 px-sm py-sm tr-text-ui text-text-muted hover:text-text-default aria-selected:bg-control-bg-selected aria-selected:text-text-default lg:min-h-0"
									onClick={() => {
										useAppStore.getState().setActiveActivity(projectAreaId, item);
									}}
								>
									{activityLabel(item)}
								</button>
							))}
						</div>
						<div id="activity-panel" role="tabpanel" className="min-h-0 flex-1 overflow-auto">
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
