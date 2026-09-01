import type { AskUserQuestionResult, PromptHit, QueueLane, WsResult } from "@gooseberry/contracts";
import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { EMPTY_RUNTIME, selectProjectAreaById, toast, useAppStore } from "@/store";
import { errorText, getTransport, wsErrorCode } from "../connection";
import {
	agentMentionIdentity,
	fileMentionCandidateIdentity,
	type LoadedAgentMentions,
	type LoadedFileMentionCandidates,
	visibleAgentMentions,
	visibleFileMentionCandidates,
} from "./agent-mention-state";
import { AskStatesContext, deriveAskStates } from "./ask-state";
import { ChatActionsContext } from "./chat-actions";
import { ChatHeader } from "./chat-header";
import {
	Composer,
	type ComposerHandle,
	type MentionCandidate,
	type SubmitBehavior,
} from "./composer";
import { loadTranscriptUntil, type TranscriptLoadOutcome } from "./history-loading";
import { HistoryOverlay } from "./history-overlay";
import {
	messagesToRuntime,
	prependTranscriptPage as prependHydratedTranscriptPage,
} from "./hydrate";
import { QueueStrip } from "./queue-strip";
import { type ChatRow, deriveRows, rowIndexForTurn } from "./rows";
import { SessionGoalControl } from "./session-goal-control";
import { SessionLineageControl } from "./session-lineage-control";
import { StreamIndicator, type StreamStatus, streamStatus } from "./stream-indicator";
import "./tools/register";
import { McpAppSessionProvider } from "./tools/apps/mcp-app-context";
import { ChatTurnView } from "./turns";
import type { ChatAttachment, ChatTurn } from "./types";
import { useChatScroll } from "./use-chat-scroll";
import { useHistorySearch } from "./use-history-search";
import { useSessionCommandSync } from "./use-session-command-sync";

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

type TranscriptLoadState = "idle" | "loading" | "error";
interface TranscriptLoadFlight {
	controller: AbortController;
	promise: Promise<TranscriptLoadOutcome>;
}

type ChatListContext = {
	status: StreamStatus | null;
	history: {
		hasEarlier: boolean;
		state: TranscriptLoadState;
		onLoad: () => void;
	};
};

function HistoryHeader({ context }: { context: ChatListContext }) {
	const { hasEarlier, state, onLoad } = context.history;
	if (!hasEarlier && state !== "error") return null;
	const label =
		state === "loading"
			? "Loading earlier messages…"
			: state === "error"
				? "Retry loading earlier messages"
				: "Load earlier messages";
	return (
		<div className="mx-auto flex max-w-3xl justify-center px-md py-sm">
			<button
				type="button"
				aria-label={label}
				disabled={state === "loading"}
				onClick={onLoad}
				className="rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-sm py-xs text-text-muted tr-text-metadata hover:bg-control-bg-hovered hover:text-text-default disabled:cursor-wait disabled:opacity-70"
			>
				{label}
			</button>
		</div>
	);
}

function StreamFooter({ context }: { context: ChatListContext }) {
	if (!context.status) return null;
	return (
		<div className="mx-auto max-w-3xl px-md pb-sm">
			<StreamIndicator status={context.status} />
		</div>
	);
}

const CHAT_LIST_COMPONENTS = { Header: HistoryHeader, Footer: StreamFooter };
const CHAT_VIRTUAL_INDEX_BASE = 1_000_000_000;

export default function ChatView({
	sessionId,
	projectAreaId,
}: {
	sessionId: string;
	projectAreaId: string;
}) {
	const runtime = useAppStore((s) => s.sessions[sessionId]) ?? EMPTY_RUNTIME;
	const connectionGeneration = useAppStore((s) => s.connectionGeneration);
	const parentDeleted = useAppStore(
		(state) =>
			runtime.parentSessionId !== undefined &&
			state.deletedSessionsByProjectArea[projectAreaId]?.[runtime.parentSessionId] === true,
	);
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

	const recentPrompts = useMemo(() => {
		const texts = turns
			.filter((t) => t.kind === "user")
			.map((t) => turnAnchorText(t))
			.filter(Boolean);
		return [...new Set(texts.reverse())];
	}, [turns]);

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const fileMentionIdentity = fileMentionCandidateIdentity(
		projectAreaId,
		projectAreaRoot,
		sessionId,
		mentionQuery,
	);
	const [loadedFileMentionCandidates, setLoadedFileMentionCandidates] = useState<
		LoadedFileMentionCandidates<MentionCandidate>
	>({ identity: null, candidates: [] });
	const fileMentionCandidates = visibleFileMentionCandidates(
		loadedFileMentionCandidates,
		fileMentionIdentity,
	);
	const mentionIdentity = agentMentionIdentity(projectId, sessionId);
	const [loadedAgentMentions, setLoadedAgentMentions] = useState<LoadedAgentMentions>({
		identity: null,
		mentions: [],
	});
	const agentMentions = visibleAgentMentions(loadedAgentMentions, mentionIdentity);
	const permission = useAppStore(
		(state) => Object.values(state.pendingPermissions[sessionId] ?? {})[0] ?? null,
	);
	const [queueEdit, setQueueEdit] = useState<{
		lane: QueueLane;
		index: number;
		original: string;
		text: string;
		revision: string;
		saving: boolean;
		error: string | null;
	} | null>(null);
	const queueEditStale =
		queueEdit !== null && !queueEdit.saving && queueEdit.revision !== runtime.queue.revision;
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
	const projectionId = runtime.transcript?.projectionId ?? null;
	const transcriptStart = runtime.transcript?.start ?? 0;
	const [transcriptLoadState, setTranscriptLoadState] = useState<TranscriptLoadState>("idle");
	const transcriptFlightRef = useRef<TranscriptLoadFlight | null>(null);
	const autoHistoryLoadArmed = useRef(false);
	const [firstItemIndex, setFirstItemIndex] = useState(CHAT_VIRTUAL_INDEX_BASE);
	const virtualOriginRef = useRef({
		projectionId,
		start: transcriptStart,
		rowCount: rows.length,
		firstItemIndex: CHAT_VIRTUAL_INDEX_BASE,
	});

	useLayoutEffect(() => {
		const previous = virtualOriginRef.current;
		const resetSnapshot =
			previous.projectionId !== projectionId || transcriptStart > previous.start;
		if (resetSnapshot) {
			virtualOriginRef.current = {
				projectionId,
				start: transcriptStart,
				rowCount: rows.length,
				firstItemIndex: CHAT_VIRTUAL_INDEX_BASE,
			};
			setFirstItemIndex(CHAT_VIRTUAL_INDEX_BASE);
			if (previous.projectionId === projectionId && transcriptStart > previous.start) {
				virtuosoRef.current?.scrollToIndex({ index: "LAST" });
			}
			return;
		}
		const addedRows =
			transcriptStart < previous.start ? Math.max(0, rows.length - previous.rowCount) : 0;
		const nextFirstItemIndex = Math.max(0, previous.firstItemIndex - addedRows);
		virtualOriginRef.current = {
			projectionId,
			start: transcriptStart,
			rowCount: rows.length,
			firstItemIndex: nextFirstItemIndex,
		};
		if (nextFirstItemIndex !== previous.firstItemIndex) {
			setFirstItemIndex(nextFirstItemIndex);
		}
	}, [projectionId, rows.length, transcriptStart]);

	const displayedFirstItemIndex =
		virtualOriginRef.current.projectionId === projectionId
			? firstItemIndex
			: CHAT_VIRTUAL_INDEX_BASE;

	const loadEarlierMessages = useCallback((): Promise<TranscriptLoadOutcome> => {
		const existing = transcriptFlightRef.current;
		if (existing) return existing.promise;
		const state = useAppStore.getState();
		const transcript = state.sessions[sessionId]?.transcript;
		if (!transcript || transcript.start <= 0) return Promise.resolve("exhausted");
		if (state.status !== "connected") {
			setTranscriptLoadState("error");
			return Promise.resolve("failed");
		}

		autoHistoryLoadArmed.current = false;
		const generation = state.connectionGeneration;
		const before = transcript.start;
		const expectedProjectionId = transcript.projectionId;
		const controller = new AbortController();
		const flight = { controller } as TranscriptLoadFlight;
		const isCurrent = () => transcriptFlightRef.current === flight;
		const isSameRuntime = () => {
			const current = useAppStore.getState();
			const currentTranscript = current.sessions[sessionId]?.transcript;
			return (
				current.status === "connected" &&
				current.connectionGeneration === generation &&
				currentTranscript?.projectionId === expectedProjectionId &&
				currentTranscript.start === before
			);
		};
		const promise = (async (): Promise<TranscriptLoadOutcome> => {
			try {
				let response: WsResult<"session.getMessages">;
				try {
					response = await getTransport().request(
						"session.getMessages",
						{
							sessionId,
							projectId: projectAreaId,
							before: { projectionId: expectedProjectionId, index: before },
						},
						{ signal: controller.signal },
					);
				} catch (error) {
					if (wsErrorCode(error) !== "STALE_TRANSCRIPT_PROJECTION") throw error;
					if (!isSameRuntime()) return "ignored";
					const snapshot = await getTransport().request(
						"session.getMessages",
						{ sessionId, projectId: projectAreaId },
						{ signal: controller.signal },
					);
					if (snapshot.kind !== "snapshot") throw new Error("invalid chat snapshot");
					if (!isSameRuntime()) return "ignored";
					const hydrated = messagesToRuntime(snapshot.messages, {
						lastSettlement: snapshot.summary.lastSettlement,
						pendingTools: snapshot.pendingTools,
						page: snapshot.page,
						isStreaming: snapshot.summary.isStreaming,
					});
					useAppStore.getState().replaceTranscriptSnapshot(sessionId, snapshot.summary, hydrated);
					if (isCurrent()) setTranscriptLoadState("idle");
					return "reloaded";
				}

				if (response.kind !== "page") throw new Error("invalid transcript page");
				if (!isSameRuntime()) return "ignored";
				const hydrated = messagesToRuntime(response.messages, { page: response.page });
				const currentRuntime = useAppStore.getState().sessions[sessionId];
				if (!currentRuntime) return "ignored";
				const preview = prependHydratedTranscriptPage(currentRuntime, hydrated);
				if (!preview) return "ignored";
				const previousRowCount = deriveRows(
					currentRuntime.turns,
					currentRuntime.toolResults,
					currentRuntime.isStreaming,
				).length;
				const nextRowCount = deriveRows(
					preview.turns,
					preview.toolResults,
					preview.isStreaming,
				).length;
				const origin = virtualOriginRef.current;
				if (origin.projectionId === expectedProjectionId && origin.start === before) {
					const nextFirstItemIndex = Math.max(
						0,
						origin.firstItemIndex - Math.max(0, nextRowCount - previousRowCount),
					);
					virtualOriginRef.current = {
						projectionId: expectedProjectionId,
						start: response.page.start,
						rowCount: nextRowCount,
						firstItemIndex: nextFirstItemIndex,
					};
					setFirstItemIndex(nextFirstItemIndex);
				}
				const applied = useAppStore.getState().prependTranscriptPage(sessionId, hydrated);
				if (!applied) return "ignored";
				if (isCurrent()) setTranscriptLoadState("idle");
				return "loaded";
			} catch (error) {
				if ((error as { name?: string }).name === "AbortError") return "ignored";
				if (isCurrent()) setTranscriptLoadState("error");
				return "failed";
			} finally {
				if (isCurrent()) transcriptFlightRef.current = null;
			}
		})();
		flight.promise = promise;
		transcriptFlightRef.current = flight;
		setTranscriptLoadState("loading");
		return promise;
	}, [projectAreaId, sessionId]);

	useEffect(() => {
		void connectionGeneration;
		void projectionId;
		void sessionId;
		setTranscriptLoadState("idle");
		autoHistoryLoadArmed.current = false;
		return () => {
			const flight = transcriptFlightRef.current;
			if (!flight) return;
			transcriptFlightRef.current = null;
			flight.controller.abort();
		};
	}, [connectionGeneration, projectionId, sessionId]);

	const requestEarlierMessages = useCallback(() => {
		void loadEarlierMessages();
	}, [loadEarlierMessages]);

	const handleStartReached = useCallback(() => {
		if (!autoHistoryLoadArmed.current) return;
		autoHistoryLoadArmed.current = false;
		void loadEarlierMessages();
	}, [loadEarlierMessages]);

	const listContext = useMemo<ChatListContext>(() => {
		const last = turns[turns.length - 1];
		const status =
			isStreaming && last?.kind !== "retry" ? streamStatus(turns, currentAssistantId) : null;
		return {
			status,
			history: {
				hasEarlier: transcriptStart > 0,
				state: transcriptLoadState,
				onLoad: requestEarlierMessages,
			},
		};
	}, [
		turns,
		isStreaming,
		currentAssistantId,
		transcriptStart,
		transcriptLoadState,
		requestEarlierMessages,
	]);
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
	const chatLocationLoadRef = useRef<{
		request: NonNullable<typeof chatLocationRequest>;
		active: boolean;
		cursor: string;
	} | null>(null);
	const [chatLocationLoadRevision, setChatLocationLoadRevision] = useState(0);
	const [flashRowId, setFlashRowId] = useState<string | null>(null);

	useSessionCommandSync(sessionId, projectAreaId);

	const mergedCommands = commands;

	// biome-ignore lint/correctness/useExhaustiveDependencies: `isStreaming` is the refetch trigger, not read
	useEffect(() => {
		getTransport()
			.request("session.getStats", { sessionId })
			.then((st) => useAppStore.getState().setStats(sessionId, st))
			.catch(() => {});
	}, [sessionId, isStreaming]);

	useEffect(() => {
		const identity = agentMentionIdentity(projectId, sessionId);
		setLoadedAgentMentions({ identity, mentions: [] });
		if (!projectId || !identity) {
			return;
		}
		let cancelled = false;
		getTransport()
			.request("session.getAgentMentions", { projectId, sessionId })
			.then((mentions) => {
				if (!cancelled) setLoadedAgentMentions({ identity, mentions });
			})
			.catch(() => {
				if (!cancelled) setLoadedAgentMentions({ identity, mentions: [] });
			});
		return () => {
			cancelled = true;
		};
	}, [projectId, sessionId]);

	useEffect(() => {
		const identity = fileMentionCandidateIdentity(
			projectAreaId,
			projectAreaRoot,
			sessionId,
			mentionQuery,
		);
		setLoadedFileMentionCandidates({ identity, candidates: [] });
		if (mentionQuery === null || !identity) {
			return;
		}
		const slash = mentionQuery.lastIndexOf("/");
		const dir = slash >= 0 ? mentionQuery.slice(0, slash) : "";
		const prefix = (slash >= 0 ? mentionQuery.slice(slash + 1) : mentionQuery).toLowerCase();
		let cancelled = false;
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.readDir", { projectId: projectAreaId, root: projectAreaRoot ?? "", path: dir })
				.then((listing) => listing.nodes)
				.then((nodes) => {
					if (cancelled) return;
					setLoadedFileMentionCandidates({
						identity,
						candidates: nodes
							.filter((n) => n.name.toLowerCase().startsWith(prefix))
							.slice(0, 12)
							.map((n) => ({ path: n.path, name: n.name, kind: n.kind })),
					});
				})
				.catch(() => {
					if (!cancelled) setLoadedFileMentionCandidates({ identity, candidates: [] });
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [mentionQuery, projectAreaId, projectAreaRoot, sessionId]);

	const mentionCandidates = useMemo(() => {
		if (mentionQuery === null) return [];
		if (mentionQuery.includes("/")) return fileMentionCandidates;
		const query = mentionQuery.toLocaleLowerCase();
		const agentCandidates: MentionCandidate[] = agentMentions
			.filter(({ name, mention }) =>
				[name, mention.startsWith("@") ? mention.slice(1) : mention].some((value) =>
					value.toLocaleLowerCase().startsWith(query),
				),
			)
			.map(({ name, description, sourceType, mention }) => ({
				name,
				description,
				sourceType,
				mention,
				kind: "agent" as const,
			}));
		return [...agentCandidates, ...fileMentionCandidates].slice(0, 12);
	}, [agentMentions, fileMentionCandidates, mentionQuery]);

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
		const heldByQueue = behavior === "send" && runtime.queue.followUp.length > 0;
		const effectiveBehavior = heldByQueue ? "queue" : behavior;
		if (effectiveBehavior === "queue" && attachments.length > 0) {
			toast.error(
				heldByQueue
					? "Resolve the queued follow-ups before sending images."
					: "Send or steer image attachments directly.",
				"Queued messages are text-only",
			);
			return false;
		}
		if (heldByQueue) toast.info("Queued behind the existing follow-ups.", "Message queued");
		if (effectiveBehavior === "send" && (text || attachments.length > 0))
			useAppStore.getState().appendUserMessage(sessionId, text, attachments);
		const images = attachments.map((a) => a.content);
		const params = { sessionId, text, ...(images.length > 0 ? { images } : {}) };
		const method =
			effectiveBehavior === "steer"
				? "session.steer"
				: effectiveBehavior === "queue"
					? "session.queueAdd"
					: "session.prompt";
		getTransport()
			.request(method, params)
			.catch((err) => {
				useAppStore.getState().appendErrorTurn(sessionId, errorText(err));
				if (effectiveBehavior !== "send") restoreTextToDraft(text);
			});
		return true;
	};

	const editQueuedMessage = (lane: "steering" | "followUp", index: number) => {
		const current = runtime.queue[lane][index];
		const revision = runtime.queue.revision;
		if (!current || !revision) return;
		setQueueEdit({
			lane,
			index,
			original: current,
			text: current,
			revision,
			saving: false,
			error: null,
		});
	};

	const saveQueuedMessage = () => {
		if (!queueEdit || queueEdit.saving || queueEditStale) return;
		const text = queueEdit.text.trim();
		if (!text || text === queueEdit.original) {
			setQueueEdit(null);
			return;
		}
		const pending = { ...queueEdit, saving: true, error: null };
		setQueueEdit(pending);
		void getTransport()
			.request("session.queueEdit", {
				sessionId,
				lane: queueEdit.lane,
				index: queueEdit.index,
				text,
				revision: queueEdit.revision,
			})
			.then(() => setQueueEdit((current) => (current === pending ? null : current)))
			.catch((error) =>
				setQueueEdit((current) =>
					current === pending ? { ...current, saving: false, error: errorText(error) } : current,
				),
			);
	};

	const removeQueuedMessage = (lane: "steering" | "followUp", index: number) => {
		const revision = runtime.queue.revision;
		if (!revision) return;
		void getTransport()
			.request("session.queueRemove", { sessionId, lane, index, revision })
			.catch((error) => toast.error(errorText(error), "Couldn't remove queued message"));
	};

	const retryQueuedMessage = (lane: "steering" | "followUp", index: number) => {
		const revision = runtime.queue.revision;
		if (!revision) return;
		void getTransport()
			.request("session.queueRetry", { sessionId, lane, index, revision })
			.catch((error) => toast.error(errorText(error), "Couldn't retry queued message"));
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
		void chatLocationLoadRevision;
		if (
			!chatLocationRequest ||
			chatLocationRequest.projectAreaId !== projectAreaId ||
			chatLocationRequest.sessionId !== sessionId
		) {
			return;
		}
		if (useAppStore.getState().chatLocationRequest !== chatLocationRequest) return;
		const { messageIndex, anchorText } = chatLocationRequest;
		if (runtime.transcript && messageIndex < runtime.transcript.start) {
			const cursor = `${runtime.transcript.projectionId}:${runtime.transcript.start}`;
			const priorLoad = chatLocationLoadRef.current;
			if (
				priorLoad?.request === chatLocationRequest &&
				(priorLoad.active || priorLoad.cursor === cursor)
			) {
				return;
			}
			const locationLoad = { request: chatLocationRequest, active: true, cursor };
			chatLocationLoadRef.current = locationLoad;
			void loadTranscriptUntil(
				messageIndex,
				() => useAppStore.getState().sessions[sessionId]?.transcript,
				loadEarlierMessages,
				() => useAppStore.getState().chatLocationRequest === chatLocationRequest,
			).finally(() => {
				if (chatLocationLoadRef.current !== locationLoad) return;
				const transcript = useAppStore.getState().sessions[sessionId]?.transcript;
				chatLocationLoadRef.current = {
					...locationLoad,
					active: false,
					cursor: transcript ? `${transcript.projectionId}:${transcript.start}` : "",
				};
				setChatLocationLoadRevision((revision) => revision + 1);
			});
			return;
		}
		const prefix = anchorText.slice(0, 40);
		const mappedId = runtime.turnIdByMessageIndex[messageIndex];
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
		virtuosoRef.current?.scrollToIndex({
			index,
			align: "center",
		});
		setFlashRowId(rows[index]?.id ?? null);
		useAppStore.getState().clearChatLocation();
	}, [
		chatLocationRequest,
		chatLocationLoadRevision,
		loadEarlierMessages,
		projectAreaId,
		rows,
		runtime.transcript,
		runtime.turnIdByMessageIndex,
		sessionId,
		turns,
	]);

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
				<div className="flex h-full min-h-0 flex-col bg-container-project-bg">
					<div className="shrink-0">
						<ChatHeader
							stats={stats}
							statusEntries={headerStatusEntries}
							left={
								<div className="flex min-w-0 items-center gap-xs">
									<SessionLineageControl
										projectAreaId={projectAreaId}
										parentSessionId={runtime.parentSessionId}
										parentDeleted={parentDeleted}
									/>
									<SessionGoalControl projectAreaId={projectAreaId} sessionId={sessionId} />
								</div>
							}
						/>
					</div>
					<Dialog
						open={permission !== null}
						onOpenChange={(open) => !open && respondToPermission()}
					>
						{permission ? (
							<DialogContent role="alertdialog" aria-label="Tool permission">
								<DialogHeader>
									<DialogTitle>Allow {permission.title}?</DialogTitle>
									<DialogDescription>
										Choose how Goose may continue with this tool request.
									</DialogDescription>
								</DialogHeader>
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
								</div>
							</DialogContent>
						) : null}
					</Dialog>
					<McpAppSessionProvider projectId={projectId} sessionId={sessionId}>
						<div
							data-testid="chat-scroll"
							className="relative flex min-h-0 flex-1 flex-col"
							{...containerProps}
							onPointerDown={(event) => {
								autoHistoryLoadArmed.current = true;
								containerProps.onPointerDown(event);
							}}
							onWheel={(event) => {
								if (event.deltaY < 0) autoHistoryLoadArmed.current = true;
								containerProps.onWheel(event);
							}}
							onTouchStart={(event) => {
								autoHistoryLoadArmed.current = true;
								containerProps.onTouchStart(event);
							}}
						>
							<Virtuoso<ChatRow, ChatListContext>
								key={projectionId ?? `live:${sessionId}`}
								ref={virtuosoRef}
								data={rows}
								context={listContext}
								components={CHAT_LIST_COMPONENTS}
								className="min-h-0 flex-1 overflow-x-hidden"
								firstItemIndex={displayedFirstItemIndex}
								initialTopMostItemIndex={{
									index: Math.max(rows.length - 1, 0),
									align: "end",
								}}
								startReached={handleStartReached}
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
					</McpAppSessionProvider>
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
							onRetry={retryQueuedMessage}
						/>
						<Dialog open={queueEdit !== null} onOpenChange={(open) => !open && setQueueEdit(null)}>
							{queueEdit ? (
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Edit queued message</DialogTitle>
										<DialogDescription>
											{runtime.queue.blocked?.lane === queueEdit.lane &&
											runtime.queue.blocked.index === queueEdit.index
												? "This may already be in the transcript. Editing changes the text used if you retry it."
												: "Update the text that Goose will receive later."}
										</DialogDescription>
									</DialogHeader>
									<textarea
										autoFocus
										aria-label="Queued message"
										value={queueEdit.text}
										disabled={queueEdit.saving}
										onChange={(event) =>
											setQueueEdit((current) =>
												current ? { ...current, text: event.target.value } : current,
											)
										}
										className="min-h-28 w-full resize-y rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg p-sm tr-text-ui text-text-default outline-none focus-visible:ring-2 focus-visible:ring-primary"
									/>
									{queueEditStale || queueEdit.error ? (
										<p role="alert" className="tr-text-ui text-feedback-warning">
											{queueEditStale
												? "The queue changed while you were editing. Copy your draft, then reopen the message to edit its current version."
												: `${queueEdit.error} Your draft is still here.`}
										</p>
									) : null}
									<DialogFooter>
										<Button variant="ghost" onClick={() => setQueueEdit(null)}>
											Cancel
										</Button>
										<Button
											disabled={!queueEdit.text.trim() || queueEdit.saving || queueEditStale}
											onClick={saveQueuedMessage}
										>
											{queueEdit.saving ? "Saving…" : "Save"}
										</Button>
									</DialogFooter>
								</DialogContent>
							) : null}
						</Dialog>
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
