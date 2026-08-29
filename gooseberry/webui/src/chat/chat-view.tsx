import type { AskUserQuestionResult, PromptHit } from "@gooseberry/contracts";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { EMPTY_RUNTIME, selectProjectAreaById, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { AskStatesContext, deriveAskStates } from "./ask-state";
import { ChatActionsContext } from "./chat-actions";
import { ChatHeader } from "./chat-header";
import {
	Composer,
	type ComposerHandle,
	type MentionCandidate,
	type SubmitBehavior,
} from "./composer";
import { HistoryOverlay } from "./history-overlay";
import { QueueStrip } from "./queue-strip";
import { type ChatRow, deriveRows, rowIndexForTurn } from "./rows";
import { SessionGoalControl } from "./session-goal-control";
import { StreamIndicator, type StreamStatus, streamStatus } from "./stream-indicator";
import "./tools/register";
import { ChatTurnView } from "./turns";
import type { ChatAttachment, ChatTurn } from "./types";
import { useChatScroll } from "./use-chat-scroll";
import { useHistorySearch } from "./use-history-search";

function turnAnchorText(turn: ChatTurn): string {
	if (turn.kind === "user") {
		const { content } = turn.message;
		return typeof content === "string"
			? content
			: content
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join("\n");
	}
	if (turn.kind === "assistant") {
		return turn.message.content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
	}
	return "";
}

type ChatListContext = { status: StreamStatus | null };

function StreamFooter({ context }: { context: ChatListContext }) {
	if (!context.status) return null;
	return (
		<div className="mx-auto max-w-3xl px-md pb-sm">
			<StreamIndicator status={context.status} />
		</div>
	);
}

const CHAT_LIST_COMPONENTS = { Footer: StreamFooter };

export default function ChatView({
	sessionId,
	projectAreaId,
}: {
	sessionId: string;
	projectAreaId: string;
}) {
	const runtime = useAppStore((s) => s.sessions[sessionId]) ?? EMPTY_RUNTIME;
	const projectId = useAppStore(
		(state) =>
			Object.values(state.projectAreas)
				.flat()
				.find((projectArea) => projectArea.id === projectAreaId)?.projectId,
	);
	const projectAreaRoot = useAppStore(
		(s) => selectProjectAreaById(s, projectAreaId)?.root ?? undefined,
	);
	const projectAreas = useAppStore((s) => s.projectAreas);
	const projectAreaNames = useMemo(() => {
		const map: Record<string, string> = {};
		for (const list of Object.values(projectAreas)) {
			for (const w of list) map[w.id] = w.name;
		}
		return map;
	}, [projectAreas]);
	const {
		turns,
		toolResults,
		isStreaming,
		currentAssistantId,
		stats,
		commands,
		draft,
		extUiStatus,
		model: sessionModel,
		thinkingLevel,
	} = runtime;

	const headerStatusEntries = useMemo<[string, string][]>(() => {
		const entries = Object.entries(extUiStatus);
		if (sessionModel) entries.push(["gooseberry-model", sessionModel.name || sessionModel.id]);
		entries.push(["gooseberry-reasoning", thinkingLevel]);
		return entries;
	}, [extUiStatus, sessionModel, thinkingLevel]);

	const rows = useMemo(
		() => deriveRows(turns, toolResults, isStreaming),
		[turns, toolResults, isStreaming],
	);

	const listContext = useMemo<ChatListContext>(() => {
		const last = turns[turns.length - 1];
		const status =
			isStreaming && last?.kind !== "retry" ? streamStatus(turns, currentAssistantId) : null;
		return { status };
	}, [turns, isStreaming, currentAssistantId]);

	const recentPrompts = useMemo(() => {
		const texts = turns
			.filter((t) => t.kind === "user")
			.map((t) => turnAnchorText(t))
			.filter(Boolean);
		return [...new Set(texts.reverse())];
	}, [turns]);

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
	const permission = useAppStore(
		(state) => Object.values(state.pendingPermissions[sessionId] ?? {})[0] ?? null,
	);
	const respondToPermission = useCallback(
		(optionId?: string) => {
			if (!permission) return;
			void getTransport()
				.request("session.permissionReply", {
					sessionId,
					permissionId: permission.id,
					...(optionId === undefined ? {} : { optionId }),
				})
				.then(() => useAppStore.getState().clearPendingPermission(sessionId, permission.id))
				.catch((error) => {
					toast.error(errorText(error), "Couldn't send permission decision");
					useAppStore.getState().clearPendingPermission(sessionId, permission.id);
				});
		},
		[permission, sessionId],
	);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const { followOutput, handleAtBottom, showScrollButton, scrollToBottom, containerProps } =
		useChatScroll(virtuosoRef);
	const composerRef = useRef<ComposerHandle>(null);
	const askFocusScope = useRef<object>({}).current;

	const {
		state: historyState,
		openOverlay,
		close: closeHistory,
		setQuery,
		cycleScope,
		setScope,
		toggleStage,
		moveSelection,
		openMessage,
	} = useHistorySearch(sessionId, projectAreaId, projectId);

	const chatLocationRequest = useAppStore((s) => s.chatLocationRequest);
	const [flashRowId, setFlashRowId] = useState<string | null>(null);

	useEffect(() => {
		getTransport()
			.request("session.getCommands", { sessionId })
			.then((c) => useAppStore.getState().setCommands(sessionId, c))
			.catch(() => {});
	}, [sessionId]);

	const mergedCommands = commands;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isStreaming` is the refetch trigger, not read
	useEffect(() => {
		getTransport()
			.request("session.getStats", { sessionId })
			.then((st) => useAppStore.getState().setStats(sessionId, st))
			.catch(() => {});
	}, [sessionId, isStreaming]);

	useEffect(() => {
		if (mentionQuery === null) {
			setMentionCandidates([]);
			return;
		}
		const slash = mentionQuery.lastIndexOf("/");
		const dir = slash >= 0 ? mentionQuery.slice(0, slash) : "";
		const prefix = (slash >= 0 ? mentionQuery.slice(slash + 1) : mentionQuery).toLowerCase();
		let cancelled = false;
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.readDir", { projectId: projectAreaId, root: projectAreaRoot ?? "", path: dir })
				.then((nodes) => {
					if (cancelled) return;
					setMentionCandidates(
						nodes
							.filter((n) => n.name.toLowerCase().startsWith(prefix))
							.slice(0, 12)
							.map((n) => ({ path: n.path, name: n.name, kind: n.kind })),
					);
				})
				.catch(() => {
					if (!cancelled) setMentionCandidates([]);
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [mentionQuery, projectAreaId, projectAreaRoot]);

	const onMentionQuery = useCallback((q: string | null) => setMentionQuery(q), []);

	const restoreTextToDraft = (text: string) => {
		if (!text.trim()) return;
		const current = useAppStore.getState().sessions[sessionId]?.draft ?? "";
		const combined = [text, current].filter((t) => t.trim()).join("\n\n");
		useAppStore.getState().setChatDraft(sessionId, combined);
		composerRef.current?.refocus();
	};

	const performSend = (
		text: string,
		attachments: ChatAttachment[],
		behavior: Exclude<SubmitBehavior, "interrupt">,
	) => {
		if (behavior === "send" && (text || attachments.length > 0))
			useAppStore.getState().appendUserMessage(sessionId, text, attachments);
		if (behavior === "queue" && attachments.length > 0) {
			toast.error("Send or steer image attachments directly.", "Queued messages are text-only");
			return false;
		}
		const images = attachments.map((a) => a.content);
		const params = { sessionId, text, ...(images.length > 0 ? { images } : {}) };
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "queue"
					? "session.queueAdd"
					: "session.prompt";
		getTransport()
			.request(method, params)
			.catch((err) => {
				useAppStore.getState().appendErrorTurn(sessionId, errorText(err));
				if (behavior !== "send") restoreTextToDraft(text);
			});
		return true;
	};

	const editQueuedMessage = (lane: "steering" | "followUp", index: number) => {
		const current = runtime.queue[lane][index];
		if (!current) return;
		const text = window.prompt("Edit queued message", current);
		if (text === null || text.trim() === current) return;
		void getTransport()
			.request("session.queueEdit", { sessionId, lane, index, text })
			.catch((error) => toast.error(errorText(error), "Couldn't edit queued message"));
	};

	const removeQueuedMessage = (lane: "steering" | "followUp", index: number) => {
		void getTransport()
			.request("session.queueRemove", { sessionId, lane, index })
			.catch((error) => toast.error(errorText(error), "Couldn't remove queued message"));
	};

	const onSubmit = (text: string, attachments: ChatAttachment[], behavior: SubmitBehavior) => {
		if (behavior !== "interrupt") {
			return performSend(text, attachments, behavior);
		}
		getTransport()
			.request("session.abort", { sessionId })
			.then(() => performSend(text, attachments, "send"))
			.catch((err) => {
				useAppStore.getState().appendErrorTurn(sessionId, errorText(err));
				restoreTextToDraft(text);
			});
		return true;
	};

	const onAbort = () => {
		getTransport()
			.request("session.abort", { sessionId })
			.catch(() => {});
	};

	const onHistoryOpen = () => openOverlay(draft);

	const onDismissHistory = () => {
		closeHistory();
		composerRef.current?.refocus();
	};

	const onInsertHit = (hit: PromptHit) => {
		composerRef.current?.insertText(hit.text);
		closeHistory();
	};

	const onInsertAndSendHit = (hit: PromptHit) => {
		composerRef.current?.insertAndSubmit(hit.text, "send");
		closeHistory();
	};

	const onDeleteHistoryChat = async (targetProjectAreaId: string, targetSessionId: string) => {
		try {
			await getTransport().request("session.delete", {
				projectId: targetProjectAreaId,
				sessionId: targetSessionId,
			});
			closeHistory();
			useAppStore.getState().deleteChat(targetProjectAreaId, targetSessionId);
		} catch (err) {
			toast.error(errorText(err), "Couldn't delete the chat");
		}
	};

	useEffect(() => {
		if (
			!chatLocationRequest ||
			chatLocationRequest.projectAreaId !== projectAreaId ||
			chatLocationRequest.sessionId !== sessionId ||
			rows.length === 0
		) {
			return;
		}
		if (useAppStore.getState().chatLocationRequest !== chatLocationRequest) return;
		const { messageIndex, anchorText } = chatLocationRequest;
		const prefix = anchorText.slice(0, 40);
		const mappedId = runtime.turnIdByMessageIndex?.[messageIndex];
		const mapped = mappedId ? turns.find((t) => t.id === mappedId) : undefined;
		const target =
			mapped && turnAnchorText(mapped).includes(prefix)
				? mapped
				: turns.findLast((t) => turnAnchorText(t).includes(prefix));
		const index = target ? rowIndexForTurn(rows, target.id) : -1;
		if (index === -1) {
			toast.error("couldn't locate the message — the session may have changed");
			useAppStore.getState().clearChatLocation();
			return;
		}
		virtuosoRef.current?.scrollToIndex({ index, align: "center" });
		setFlashRowId(rows[index]?.id ?? null);
		useAppStore.getState().clearChatLocation();
	}, [chatLocationRequest, sessionId, rows, runtime.turnIdByMessageIndex, turns, projectAreaId]);

	const historyOpenRequest = useAppStore((s) => s.historyOpenRequest);
	const historyOverlayOpen = historyState.open;
	useEffect(() => {
		if (historyOpenRequest?.sessionId !== sessionId) return;
		if (useAppStore.getState().historyOpenRequest !== historyOpenRequest) return;
		useAppStore.getState().clearHistoryOpen();
		if (historyOverlayOpen) cycleScope();
		else composerRef.current?.openHistory();
	}, [historyOpenRequest, sessionId, historyOverlayOpen, cycleScope]);

	useEffect(() => {
		if (flashRowId === null) return;
		const timer = setTimeout(() => setFlashRowId(null), 1600);
		return () => clearTimeout(timer);
	}, [flashRowId]);

	const onOpenChange = useCallback(
		(path: string) => {
			useAppStore.getState().requestChangesView(projectAreaId, path);
		},
		[projectAreaId],
	);

	const askStates = useMemo(
		() => deriveAskStates(runtime.turns, runtime.askAnswers),
		[runtime.turns, runtime.askAnswers],
	);
	const askContext = useMemo(
		() => ({ states: askStates, focusScope: askFocusScope }),
		[askStates, askFocusScope],
	);

	const chatActions = useMemo(
		() => ({
			answerQuestion: (toolCallId: string, result: AskUserQuestionResult) =>
				getTransport()
					.request("session.questionReply", { sessionId, toolCallId, result })
					.then(() => useAppStore.getState().setAskAnswer(sessionId, toolCallId, result))
					.catch((error) => {
						toast.error(errorText(error), "Couldn't send the answer");
						throw error;
					}),
			focusComposer: () => composerRef.current?.refocus(),
		}),
		[sessionId],
	);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<AskStatesContext.Provider value={askContext}>
				<div className="flex h-full min-h-0 flex-col bg-container-projectArea-bg">
					<div className="shrink-0">
						<ChatHeader
							stats={stats}
							statusEntries={headerStatusEntries}
							left={<SessionGoalControl projectAreaId={projectAreaId} sessionId={sessionId} />}
						/>
					</div>
					{permission ? (
						<div
							role="alertdialog"
							aria-label="Tool permission"
							className="mx-md mt-sm rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg p-sm shadow-[var(--shadow-md)]"
						>
							<div className="mb-xs text-text-default tr-text-body">Allow {permission.title}?</div>
							<div className="flex flex-wrap gap-xs">
								{permission.options.map((option) => (
									<button
										type="button"
										key={option.optionId}
										onClick={() => respondToPermission(option.optionId)}
										className="rounded border border-border-default px-sm py-xs text-text-default tr-text-metadata hover:bg-control-bg-hovered"
									>
										{option.name} ({option.kind})
									</button>
								))}
								<button
									type="button"
									onClick={() => respondToPermission()}
									className="rounded border border-border-default px-sm py-xs text-text-muted tr-text-metadata hover:bg-control-bg-hovered"
								>
									Cancel
								</button>
							</div>
						</div>
					) : null}
					<div
						data-testid="chat-scroll"
						className="relative flex min-h-0 flex-1 flex-col"
						{...containerProps}
					>
						<Virtuoso<ChatRow, ChatListContext>
							ref={virtuosoRef}
							data={rows}
							context={listContext}
							components={CHAT_LIST_COMPONENTS}
							className="min-h-0 flex-1 overflow-x-hidden"
							initialTopMostItemIndex={{ index: Math.max(rows.length - 1, 0), align: "end" }}
							followOutput={followOutput}
							atBottomStateChange={handleAtBottom}
							atBottomThreshold={50}
							computeItemKey={(_, row) => row.id}
							itemContent={(_, row) => (
								<div
									data-flash={row.id === flashRowId || undefined}
									className="mx-auto max-w-3xl rounded-[var(--radius-sm)] px-md py-xs transition-colors data-[flash]:bg-primary-subtle"
								>
									<ChatTurnView
										row={row}
										projectAreaRoot={projectAreaRoot}
										onOpenChange={onOpenChange}
									/>
								</div>
							)}
						/>
						{showScrollButton ? (
							<button
								type="button"
								data-testid="scroll-to-bottom"
								onClick={scrollToBottom}
								className="-translate-x-1/2 absolute bottom-md left-1/2 flex items-center gap-xs rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs text-text-muted tr-text-metadata shadow-[var(--shadow-md)] hover:bg-control-bg-hovered hover:text-text-default"
							>
								<ArrowDown className="size-3" />
								New messages
							</button>
						) : null}
					</div>
					<div className="relative shrink-0">
						<HistoryOverlay
							state={historyState}
							projectAreaNames={projectAreaNames}
							onQueryChange={setQuery}
							onSetScope={setScope}
							onToggleStage={toggleStage}
							onMoveSelection={moveSelection}
							onClose={onDismissHistory}
							onInsert={onInsertHit}
							onInsertAndSend={onInsertAndSendHit}
							onOpenMessage={openMessage}
							onDeleteChat={(wsId, id) => void onDeleteHistoryChat(wsId, id)}
						/>
						<QueueStrip
							queue={runtime.queue}
							onEdit={editQueuedMessage}
							onRemove={removeQueuedMessage}
						/>
						<Composer
							ref={composerRef}
							value={draft}
							onChange={(v) => useAppStore.getState().setChatDraft(sessionId, v)}
							isStreaming={isStreaming}
							commands={mergedCommands}
							mentionCandidates={mentionCandidates}
							recentPrompts={recentPrompts}
							onMentionQuery={onMentionQuery}
							onSubmit={onSubmit}
							onAbort={onAbort}
							onHistoryOpen={onHistoryOpen}
						/>
					</div>
				</div>
			</AskStatesContext.Provider>
		</ChatActionsContext.Provider>
	);
}
