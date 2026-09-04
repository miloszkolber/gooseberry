import type {
	AgentEvent,
	AskUserQuestionResult,
	ExtUiRequest,
	ImageContent,
	PermissionRequest,
	SessionGoal,
	SessionModeState,
	SessionPlanState,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	TextResourceAttachmentMarker,
	ThinkingLevel,
	WireModel,
} from "@gooseberry/contracts";
import type { ChatAttachment, ChatTurn } from "@/chat/runtime/types";
import { randomId } from "@/lib";
import type { AppState } from "@/store/app-store";
import type { StateCreator } from "@/store/external-store";
import { omitKey } from "@/store/record";
import type { ChatTab } from "../../workspace/store/model";
import {
	type HydratedRuntime,
	prependTranscriptPage as prependHydratedTranscriptPage,
} from "./hydrate";
import {
	clearTurnStreaming,
	reduceSessionEvent,
	reduceSessionExtUi,
	type SessionRuntime,
} from "./session-runtime";

export interface ChatState {
	sessions: Record<string, SessionRuntime>;
	pendingPermissions: Record<string, Record<string, PermissionRequest>>;
	setPendingPermission: (request: PermissionRequest) => void;
	clearPendingPermission: (sessionId: string, id: string) => void;
	appendUserMessage: (sessionId: string, text: string, attachments?: ChatAttachment[]) => void;
	appendErrorTurn: (sessionId: string, text: string) => void;
	handleAgentEvent: (event: AgentEvent, sessionId: string) => void;
	setAskAnswer: (sessionId: string, toolCallId: string, result: AskUserQuestionResult) => void;
	setCurrentModel: (sessionId: string, model: WireModel, expectedRevision?: number) => void;
	setThinkingLevel: (sessionId: string, level: ThinkingLevel, expectedRevision?: number) => void;
	setStats: (sessionId: string, stats: SessionStats) => void;
	setCommands: (sessionId: string, commands: SlashCommandInfo[], expectedRevision?: number) => void;
	setChatDraft: (sessionId: string, text: string) => void;
	prependTranscriptPage: (sessionId: string, hydrated: HydratedRuntime) => boolean;
	replaceTranscriptSnapshot: (
		sessionId: string,
		summary: SessionSummary,
		hydrated: HydratedRuntime,
		modes: SessionModeState | null,
		planState: SessionPlanState | null,
	) => void;
	setSessionGoalLoading: (sessionId: string, projectAreaId: string) => void;
	setSessionGoalSaving: (sessionId: string, projectAreaId: string) => void;
	setSessionGoal: (sessionId: string, value: SessionGoal, expectedRevision?: number) => void;
	setSessionGoalError: (sessionId: string, projectAreaId: string, error: string) => void;
	clearPendingExtUi: (sessionId: string, id: string) => void;
	applyExtUi: (request: ExtUiRequest) => void;
}

function withRuntime(
	s: AppState,
	sessionId: string,
	update: (rt: SessionRuntime) => SessionRuntime,
): Partial<AppState> {
	const rt = s.sessions[sessionId];
	if (!rt) return {};
	const next = update(rt);
	return next === rt ? {} : { sessions: { ...s.sessions, [sessionId]: next } };
}

function sameUserContent(a: ChatTurn, b: ChatTurn): boolean {
	if (a.kind !== "user" || b.kind !== "user") return false;
	const normalize = (content: typeof a.message.content) =>
		(typeof content === "string" ? [{ type: "text" as const, text: content }] : content).filter(
			(block) => block.type !== "text" || block.text.length > 0,
		);
	const left = normalize(a.message.content);
	const right = normalize(b.message.content);
	return (
		left.length === right.length &&
		left.every((block, index) => {
			const other = right[index];
			if (!other || block.type !== other.type) return false;
			return block.type === "text"
				? block.text === (other.type === "text" ? other.text : undefined)
				: block.type === "image"
					? block.data === (other.type === "image" ? other.data : undefined) &&
						block.mimeType === (other.type === "image" ? other.mimeType : undefined)
					: block.name === (other.type === "resource" ? other.name : undefined) &&
						block.mimeType === (other.type === "resource" ? other.mimeType : undefined);
		})
	);
}

function optimisticAttachmentBlocks(
	attachments: ChatAttachment[],
): (ImageContent | TextResourceAttachmentMarker)[] {
	return attachments.map((attachment) =>
		attachment.kind === "image"
			? attachment.content
			: {
					type: "resource" as const,
					name: attachment.content.name,
					mimeType: attachment.content.mimeType,
				},
	);
}

function unmatchedOptimisticTurns(
	runtime: SessionRuntime,
	hydrated: HydratedRuntime,
): Extract<ChatTurn, { kind: "user" }>[] {
	const pending = runtime.turns.filter(
		(turn): turn is Extract<ChatTurn, { kind: "user" }> =>
			turn.kind === "user" && turn.optimistic !== undefined,
	);
	if (pending.length === 0) return [];
	const messageIndexByTurnId = new Map<string, number>();
	for (const [index, turnId] of Object.entries(hydrated.turnIdByMessageIndex)) {
		if (turnId) messageIndexByTurnId.set(turnId, Number(index));
	}
	const available = hydrated.turns.filter(
		(turn): turn is Extract<ChatTurn, { kind: "user" }> => turn.kind === "user",
	);
	const consumed = new Set<string>();
	return pending.filter((optimistic) => {
		const baseline = optimistic.optimistic?.transcriptTotal ?? null;
		const match = available.find(
			(turn) =>
				!consumed.has(turn.id) &&
				(baseline === null || (messageIndexByTurnId.get(turn.id) ?? -1) >= baseline) &&
				sameUserContent(optimistic, turn),
		);
		if (!match) return true;
		consumed.add(match.id);
		return false;
	});
}

export const createChatState: StateCreator<AppState, [], [], ChatState> = (set) => ({
	sessions: {},
	pendingPermissions: {},
	setPendingPermission: (request) =>
		set((state) => ({
			pendingPermissions: {
				...state.pendingPermissions,
				[request.sessionId]: {
					...state.pendingPermissions[request.sessionId],
					[request.id]: request,
				},
			},
		})),
	clearPendingPermission: (sessionId, id) =>
		set((state) =>
			!state.pendingPermissions[sessionId]?.[id]
				? state
				: {
						pendingPermissions:
							Object.keys(state.pendingPermissions[sessionId]).length === 1
								? omitKey(state.pendingPermissions, sessionId)
								: {
										...state.pendingPermissions,
										[sessionId]: omitKey(state.pendingPermissions[sessionId], id),
									},
					},
		),
	appendUserMessage: (sessionId, text, attachments) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				turns: [
					...rt.turns,
					{
						kind: "user",
						id: randomId("turn"),
						message: {
							role: "user",
							content:
								attachments && attachments.length > 0
									? [
											...(text ? [{ type: "text" as const, text }] : []),
											...optimisticAttachmentBlocks(attachments),
										]
									: text,
							timestamp: Date.now(),
						},
						optimistic: { transcriptTotal: rt.transcript?.total ?? null },
						...(attachments && attachments.length > 0
							? {
									imageAttachmentNames: attachments
										.filter((attachment) => attachment.kind === "image")
										.map((attachment) => attachment.name),
								}
							: {}),
					},
				],
			})),
		),
	appendErrorTurn: (sessionId, text) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				isStreaming: false,
				currentAssistantId: null,
				attemptAssistantId: null,
				turns: [...clearTurnStreaming(rt.turns), { kind: "error", id: randomId("turn"), text }],
			})),
		),
	handleAgentEvent: (event, sessionId) =>
		set((s) => withRuntime(s, sessionId, (rt) => reduceSessionEvent(rt, event))),
	setCurrentModel: (sessionId, model, expectedRevision) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) =>
				expectedRevision !== undefined && rt.configRevision !== expectedRevision
					? rt
					: { ...rt, model, configRevision: rt.configRevision + 1 },
			),
		),
	setThinkingLevel: (sessionId, level, expectedRevision) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) =>
				expectedRevision !== undefined && rt.configRevision !== expectedRevision
					? rt
					: { ...rt, thinkingLevel: level, configRevision: rt.configRevision + 1 },
			),
		),
	setStats: (sessionId, stats) => set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, stats }))),
	setCommands: (sessionId, commands, expectedRevision) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) =>
				expectedRevision !== undefined && rt.commandRevision !== expectedRevision
					? rt
					: { ...rt, commands },
			),
		),
	setChatDraft: (sessionId, draft) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, draft }))),
	prependTranscriptPage: (sessionId, hydrated) => {
		let applied = false;
		set((s) =>
			withRuntime(s, sessionId, (rt) => {
				const next = prependHydratedTranscriptPage(rt, hydrated);
				applied = next !== null;
				return next ?? rt;
			}),
		);
		return applied;
	},
	replaceTranscriptSnapshot: (sessionId, summary, hydrated, modes, planState) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => {
				const optimisticTurns = unmatchedOptimisticTurns(rt, hydrated);
				const next: SessionRuntime = {
					...rt,
					turns: [...hydrated.turns, ...optimisticTurns],
					toolResults: hydrated.toolResults,
					turnIdByMessageIndex: hydrated.turnIdByMessageIndex,
					transcript: hydrated.transcript,
					currentAssistantId: hydrated.currentAssistantId,
					attemptAssistantId: null,
					isStreaming: summary.isStreaming,
					model: summary.model,
					thinkingLevel: summary.thinkingLevel,
					configRevision: rt.configRevision + 1,
					modes,
					planState,
					...(summary.queue ? { queue: summary.queue } : {}),
				};
				if (summary.parentSessionId) next.parentSessionId = summary.parentSessionId;
				else delete next.parentSessionId;
				return next;
			}),
		),
	setSessionGoalLoading: (sessionId, projectAreaId) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, projectAreaId, status: "loading", error: null },
			})),
		),
	setSessionGoalSaving: (sessionId, projectAreaId) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, projectAreaId, status: "saving", error: null },
			})),
		),
	setSessionGoal: (sessionId, value, expectedRevision) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) =>
				expectedRevision !== undefined && rt.goalRevision !== expectedRevision
					? rt
					: {
							...rt,
							goal: {
								projectAreaId: value.projectId,
								status: "ready",
								goal: value.goal,
								tasks: value.tasks,
								updatedAt: value.updatedAt,
								error: null,
							},
							goalRevision: rt.goalRevision + 1,
						},
			),
		),
	setSessionGoalError: (sessionId, projectAreaId, error) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: { ...rt.goal, projectAreaId, status: "error", error },
			})),
		),
	clearPendingExtUi: (sessionId, id) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => {
				if (rt.pendingExtUi?.id !== id) return rt;
				const [next, ...rest] = rt.extUiQueue;
				return { ...rt, pendingExtUi: next ?? null, extUiQueue: rest };
			}),
		),
	applyExtUi: (request) =>
		set((s): Partial<AppState> => {
			if (request.kind === "setTitle") {
				for (const [wsId, tabs] of Object.entries(s.tabsByProjectArea)) {
					const chat = tabs.find(
						(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === request.sessionId,
					);
					if (!chat) continue;
					if (chat.name === request.title) continue;
					return {
						tabsByProjectArea: {
							...s.tabsByProjectArea,
							[wsId]: tabs.map((tab) =>
								tab.id === chat.id ? { ...chat, name: request.title } : tab,
							),
						},
					};
				}
				for (const [wsId, chats] of Object.entries(s.closedChatsByProjectArea)) {
					if (!chats.some((chat) => chat.sessionId === request.sessionId)) continue;
					return {
						closedChatsByProjectArea: {
							...s.closedChatsByProjectArea,
							[wsId]: chats.map((chat) =>
								chat.sessionId === request.sessionId ? { ...chat, title: request.title } : chat,
							),
						},
					};
				}
				return {};
			}
			return withRuntime(s, request.sessionId, (rt) => reduceSessionExtUi(rt, request));
		}),
	setAskAnswer: (sessionId, toolCallId, result) =>
		set((state) => {
			const runtime = state.sessions[sessionId];
			if (!runtime) return state;
			return {
				sessions: {
					...state.sessions,
					[sessionId]: {
						...runtime,
						askAnswers: { ...runtime.askAnswers, [toolCallId]: result },
					},
				},
			};
		}),
});
