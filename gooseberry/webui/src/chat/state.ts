import type {
	AgentEvent,
	AskUserQuestionResult,
	ExtUiRequest,
	PermissionRequest,
	SessionGoal,
	SessionStats,
	SlashCommandInfo,
	ThinkingLevel,
	WireModel,
} from "@gooseberry/contracts";
import type { StateCreator } from "zustand";
import type { ChatAttachment } from "@/chat/types";
import type { AppState } from "@/store/app-store";
import { omitKey } from "@/store/record";
import type { ChatTab } from "../workspace/model";
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
	setCurrentModel: (sessionId: string, model: WireModel) => void;
	setThinkingLevel: (sessionId: string, level: ThinkingLevel) => void;
	setStats: (sessionId: string, stats: SessionStats) => void;
	setCommands: (sessionId: string, commands: SlashCommandInfo[], expectedRevision?: number) => void;
	setChatDraft: (sessionId: string, text: string) => void;
	setSessionGoalLoading: (sessionId: string, projectAreaId: string) => void;
	setSessionGoalSaving: (sessionId: string, projectAreaId: string) => void;
	setSessionGoal: (sessionId: string, value: SessionGoal) => void;
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
						id: crypto.randomUUID(),
						message: {
							role: "user",
							content:
								attachments && attachments.length > 0
									? [
											...(text ? [{ type: "text" as const, text }] : []),
											...attachments.map((a) => a.content),
										]
									: text,
							timestamp: Date.now(),
						},
						...(attachments && attachments.length > 0
							? { attachmentNames: attachments.map((a) => a.name) }
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
				turns: [...clearTurnStreaming(rt.turns), { kind: "error", id: crypto.randomUUID(), text }],
			})),
		),
	handleAgentEvent: (event, sessionId) =>
		set((s) => withRuntime(s, sessionId, (rt) => reduceSessionEvent(rt, event))),
	setCurrentModel: (sessionId, model) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, model }))),
	setThinkingLevel: (sessionId, level) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, thinkingLevel: level }))),
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
	setSessionGoal: (sessionId, value) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				goal: {
					projectAreaId: value.projectId,
					status: "ready",
					goal: value.goal,
					tasks: value.tasks,
					updatedAt: value.updatedAt,
					error: null,
				},
			})),
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
