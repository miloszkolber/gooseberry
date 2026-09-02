import type { AskUserQuestionItem, AskUserQuestionResult } from "@gooseberry/contracts";
import { Check, CircleDot, ListChecks, MessageCircleQuestion } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib";
import type { ToolRenderProps } from "../render/tool-registry";
import { useAskFocusScope, useAskState } from "../runtime/ask-state";
import { useChatActions } from "../session/chat-actions";
import { QuestionBody } from "./ask-user-question-body";
import { ResolvedRecord, ReviewView, SupersededRecord } from "./ask-user-question-record";
import {
	answerSupportsNote,
	type ChoiceNudge,
	createQuestionAttentionClaim,
	deriveAnswers,
	emptyQuestionState,
	nudgeShowsOnPage,
	parseQuestions,
	type QuestionFocusTarget,
	type QuestionState,
	questionPageForKey,
	readAskResult,
	shouldClaimQuestionFocus,
	shouldFocusPageTarget,
} from "./ask-user-question-state";
import { resultText } from "./tool-helpers";

const panelDomId = (toolCallId: string) => `ask-panel-${toolCallId}`;
const tabDomId = (toolCallId: string, page: number | "review") => `ask-tab-${toolCallId}-${page}`;

const claimQuestionAttention = createQuestionAttentionClaim();
const ATTENTION_SETTLE_FRAMES = 30;
const MODAL_SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function focusTargetKind(active: Element | null, card: HTMLElement): QuestionFocusTarget {
	if (!active || active === document.body) return "none";
	if (card.contains(active)) return "non-editing";
	if (!(active instanceof HTMLElement)) return "editing";
	if (active.closest(MODAL_SURFACES)) return "modal";
	if (active.isContentEditable || active.closest('[contenteditable="true"]')) return "editing";
	const control = active.closest("input, textarea, select, iframe");
	if (!control) return "non-editing";
	if (control instanceof HTMLTextAreaElement && control.dataset.testid === "chat-input") {
		return control.value.length === 0 ? "empty-composer" : "draft-composer";
	}
	return "editing";
}

function hasCoarsePointer(): boolean {
	return window.matchMedia("(pointer: coarse)").matches;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(!!target.closest("input, textarea, select") ||
			target.isContentEditable ||
			!!target.closest('[contenteditable="true"]'))
	);
}

function focusCurrentQuestionPage(card: HTMLElement): void {
	const target = card.querySelector<HTMLElement>('[data-ask-page-focus="true"]:not([disabled])');
	if (!target) return;
	if (!shouldFocusPageTarget(isTextEntryTarget(target), hasCoarsePointer())) return;
	target.focus({ preventScroll: true });
}

function focusQuestionAttention(card: HTMLElement): void {
	const selected = card.querySelector<HTMLElement>(
		'[data-testid="ask-option"][data-selected="true"], [data-testid="ask-custom-row"][data-selected="true"] input',
	);
	if (selected) selected.focus({ preventScroll: true });
	else focusCurrentQuestionPage(card);
}

interface CachedCardState {
	states: Record<number, QuestionState>;
	tab: number;
	submitted: boolean;
}
const cardStateCache = new Map<string, CachedCardState>();

export function AskUserQuestionCard({ toolCallId, args, result, status }: ToolRenderProps) {
	const actions = useChatActions();
	const ask = useAskState(toolCallId);
	const providedFocusScope = useAskFocusScope();
	const localFocusScope = useRef<object>({}).current;
	const focusScope = providedFocusScope ?? localFocusScope;
	const cardRef = useRef<HTMLElement>(null);
	const questions = useMemo(() => parseQuestions(args), [args]);
	const resolvedResult = ask?.answer ?? readAskResult(result);
	const awaiting = !resolvedResult && !ask?.superseded && status !== "error";
	const [states, setStates] = useState<Record<number, QuestionState>>(
		() => cardStateCache.get(toolCallId)?.states ?? {},
	);
	const [tab, setTab] = useState(() => cardStateCache.get(toolCallId)?.tab ?? 0);
	const [submitted, setSubmitted] = useState(
		() => cardStateCache.get(toolCallId)?.submitted ?? false,
	);
	const [announced, setAnnounced] = useState(false);
	const [nudge, setNudge] = useState<ChoiceNudge | null>(null);
	const [nudgeSpoken, setNudgeSpoken] = useState(false);
	const nudgeSeq = useRef(0);
	const previousTab = useRef(tab);
	const reclaimFocusAfterFailedSend = useRef(false);

	useEffect(() => {
		if (awaiting) cardStateCache.set(toolCallId, { states, tab, submitted });
		else cardStateCache.delete(toolCallId);
	}, [toolCallId, awaiting, states, tab, submitted]);

	useEffect(() => {
		setNudgeSpoken(false);
		if (!nudge) return;
		const frame = requestAnimationFrame(() => setNudgeSpoken(true));
		const timer = setTimeout(() => setNudge(null), 2500);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(timer);
		};
	}, [nudge]);

	useEffect(() => {
		if (!reclaimFocusAfterFailedSend.current || submitted) return;
		reclaimFocusAfterFailedSend.current = false;
		const card = cardRef.current;
		if (card) focusQuestionAttention(card);
	});

	useEffect(() => {
		if (previousTab.current === tab) return;
		previousTab.current = tab;
		const frame = requestAnimationFrame(() => {
			if (cardRef.current) focusCurrentQuestionPage(cardRef.current);
		});
		return () => cancelAnimationFrame(frame);
	}, [tab]);

	useEffect(() => {
		if (!awaiting || questions.length === 0 || submitted) return;
		let frame: number | null = null;
		let attempts = 0;
		let userTookOver = false;
		const yieldToUser = () => {
			userTookOver = true;
		};
		window.addEventListener("pointerdown", yieldToUser, { capture: true, once: true });
		window.addEventListener("keydown", yieldToUser, { capture: true, once: true });
		const settleFocus = () => {
			const card = cardRef.current;
			if (!card || userTookOver) return;
			const kind = focusTargetKind(document.activeElement, card);
			if (!shouldClaimQuestionFocus(kind, hasCoarsePointer())) return;
			focusQuestionAttention(card);
			if (card.contains(document.activeElement)) return;
			attempts += 1;
			if (attempts < ATTENTION_SETTLE_FRAMES) frame = requestAnimationFrame(settleFocus);
		};
		frame = requestAnimationFrame(() => {
			if (!claimQuestionAttention(focusScope, toolCallId)) return;
			setAnnounced(true);
			const card = cardRef.current;
			if (!card) return;
			card.scrollIntoView({ block: "nearest" });
			settleFocus();
		});
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			window.removeEventListener("pointerdown", yieldToUser, { capture: true });
			window.removeEventListener("keydown", yieldToUser, { capture: true });
		};
	}, [awaiting, focusScope, questions.length, submitted, toolCallId]);

	const stateFor = (qi: number): QuestionState => states[qi] ?? emptyQuestionState();
	const patch = (qi: number, next: Partial<QuestionState>) =>
		setStates((prev) => ({ ...prev, [qi]: { ...(prev[qi] ?? emptyQuestionState()), ...next } }));

	const answers = deriveAnswers(questions, states);
	const answeredIndices = new Set(answers.map((a) => a.questionIndex));

	const reply = (r: AskUserQuestionResult) => {
		if (!actions) return;
		const held = document.activeElement;
		const handedOff = !!held && !!cardRef.current?.contains(held) && held.matches(":focus-visible");
		if (handedOff) actions.focusComposer();
		setSubmitted(true);
		actions.answerQuestion(toolCallId, r).catch(() => {
			reclaimFocusAfterFailedSend.current = handedOff;
			setSubmitted(false);
		});
	};

	if (resolvedResult) {
		return (
			<ResolvedRecord questions={questions} result={resolvedResult} rawText={resultText(result)} />
		);
	}
	if (ask?.superseded) return <SupersededRecord questions={questions} />;
	if (status === "error") {
		return <ResolvedRecord questions={questions} result={null} rawText={resultText(result)} />;
	}
	if (questions.length === 0) return <ComposingCard count={questions.length} />;
	if (submitted) {
		return (
			<WaitingCard>
				<span data-testid="ask-sent">Answer sent — continuing…</span>
			</WaitingCard>
		);
	}

	const multipleQuestions = questions.length > 1;
	const reviewTab = questions.length;
	const onReview = tab >= reviewTab;
	const idx = Math.min(tab, questions.length - 1);
	const q = questions[idx];
	const state = stateFor(idx);
	if (!q) return <WaitingCard>Preparing questions…</WaitingCard>;

	const showContinue = multipleQuestions && !onReview;
	const canSubmit =
		!!actions && (onReview || !multipleQuestions ? answers.length > 0 : answeredIndices.has(idx));
	const nudgeVisible = nudgeShowsOnPage(nudge, idx, onReview, answeredIndices.has(idx));

	const confirmQuestion = (nextState: QuestionState) => {
		const nextStates = { ...states, [idx]: nextState };
		const nextAnswers = deriveAnswers(questions, nextStates);
		if (!nextAnswers.some((answer) => answer.questionIndex === idx)) {
			nudgeSeq.current += 1;
			setNudge({ question: idx, seq: nudgeSeq.current });
			return;
		}
		setNudge(null);
		setStates(nextStates);
		if (multipleQuestions) setTab(Math.min(idx + 1, reviewTab));
		else reply({ answers: nextAnswers, cancelled: false });
	};

	const onCardKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (
			event.key === "Escape" &&
			event.shiftKey &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey
		) {
			event.preventDefault();
			event.stopPropagation();
			reply({ answers: [], cancelled: true });
			return;
		}
		if (
			!multipleQuestions ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			isTextEntryTarget(event.target)
		)
			return;
		const next = questionPageForKey(event.key, tab, reviewTab);
		if (next == null) return;
		event.preventDefault();
		if (next !== tab) setTab(next);
	};

	return (
		<div className="flex flex-col gap-xs motion-safe:animate-reveal">
			<AttentionLine announced={announced} />
			<section
				ref={cardRef}
				data-testid="ask-user-question"
				data-tone="active"
				aria-label="Question from agent"
				aria-keyshortcuts="Shift+Escape"
				onKeyDown={onCardKeyDown}
				className="overflow-hidden rounded-[var(--radius-lg)] border border-primary bg-clip-padding bg-container-elevated-bg ring-2 ring-primary-soft"
			>
				{multipleQuestions ? (
					<div
						role="tablist"
						aria-label="Questions"
						className="flex items-center gap-xs overflow-x-auto border-border-default border-b px-md py-sm"
					>
						{questions.map((question, i) => (
							<TabChip
								key={question.question}
								id={tabDomId(toolCallId, i)}
								controls={panelDomId(toolCallId)}
								label={question.header || `Q${i + 1}`}
								active={tab === i}
								answered={answeredIndices.has(i)}
								onClick={() => setTab(i)}
							/>
						))}
						<TabChip
							id={tabDomId(toolCallId, "review")}
							controls={panelDomId(toolCallId)}
							label="Review & submit"
							active={onReview}
							answered={false}
							onClick={() => setTab(reviewTab)}
						/>
					</div>
				) : null}

				<div
					{...(multipleQuestions
						? {
								role: "tabpanel",
								id: panelDomId(toolCallId),
								"aria-labelledby": tabDomId(toolCallId, onReview ? "review" : idx),
							}
						: {})}
					className="flex flex-col gap-md p-md"
				>
					{onReview ? (
						<ReviewView
							questions={questions}
							answers={answers}
							submitEnabled={canSubmit}
							onJump={setTab}
						/>
					) : (
						<QuestionBody
							question={q}
							state={state}
							pageKeys={multipleQuestions}
							onChange={(next) => patch(idx, next)}
							onConfirm={confirmQuestion}
						/>
					)}

					<div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
						<ModeHint
							question={onReview ? undefined : q}
							review={onReview}
							multipleQuestions={multipleQuestions}
							noteAvailable={
								!onReview && answers.some((a) => a.questionIndex === idx && answerSupportsNote(a))
							}
						/>
						<div className="flex items-center justify-end gap-md">
							{nudgeVisible ? (
								<span
									aria-hidden={nudgeSpoken || undefined}
									data-testid="ask-needs-choice"
									className="shrink-0 whitespace-nowrap text-feedback-warning tr-text-metadata"
								>
									Choose an option first
								</span>
							) : null}
							<span role="status" aria-live="polite" className="sr-only">
								{nudgeVisible && nudgeSpoken ? "Choose an option first." : ""}
							</span>
							<button
								type="button"
								data-testid="ask-skip"
								onClick={() => reply({ answers: [], cancelled: true })}
								disabled={!actions}
								className="shrink-0 rounded-[var(--radius-sm)] px-xs text-text-muted tr-text-ui outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text"
							>
								Skip
							</button>
							{showContinue ? (
								<button
									type="button"
									data-testid="ask-continue"
									onClick={() => setTab(Math.min(tab + 1, reviewTab))}
									className="shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-control-primary-bg px-md py-1.5 tr-text-action text-control-primary-text outline-none hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
								>
									Next →
								</button>
							) : (
								<button
									type="button"
									data-testid="ask-submit"
									data-ask-page-focus={onReview && canSubmit ? "true" : undefined}
									onClick={() => reply({ answers, cancelled: false })}
									disabled={!canSubmit}
									className="shrink-0 whitespace-nowrap rounded-[var(--radius-sm)] bg-control-primary-bg px-md py-1.5 tr-text-action text-control-primary-text outline-none hover:bg-control-primary-bg-hovered focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
								>
									Submit
								</button>
							)}
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}

function AttentionLine({ announced }: { announced: boolean }) {
	return (
		<div className="flex items-center gap-xs text-primary tr-text-action">
			<span aria-hidden={announced || undefined} className="flex items-center gap-xs">
				<MessageCircleQuestion className="size-3.5 shrink-0" />
				<span>Your input is needed</span>
				<span className="text-text-muted tr-text-metadata">· Agent is waiting</span>
			</span>
			<span role="status" aria-live="polite" className="sr-only">
				{announced ? "Your input is needed — the agent is waiting." : ""}
			</span>
		</div>
	);
}

function WaitingCard({ children }: { children: React.ReactNode }) {
	return (
		<div
			data-testid="ask-user-question"
			data-tone="pending"
			role="status"
			className="flex items-center gap-xs rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg px-md py-sm text-text-muted tr-text-metadata"
		>
			<MessageCircleQuestion className="size-3.5 shrink-0" />
			{children}
		</div>
	);
}

function ComposingCard({ count }: { count: number }) {
	return (
		<div className="flex flex-col gap-xs">
			<div className="text-text-muted tr-text-metadata">Agent is preparing questions…</div>
			<div
				data-testid="ask-user-question"
				data-tone="pending"
				className="flex flex-col gap-sm rounded-[var(--radius-lg)] border border-border-default bg-container-elevated-bg px-md py-sm"
			>
				<div className="flex items-center gap-xs text-text-muted tr-text-metadata">
					<MessageCircleQuestion className="size-3.5 shrink-0" />
					Preparing questions…{count > 0 ? ` (${count} ready)` : ""}
				</div>
				<div className="flex animate-pulse flex-col gap-xs" aria-hidden="true">
					<div className="h-8 rounded-[var(--radius-sm)] bg-control-bg-selected" />
					<div className="h-8 rounded-[var(--radius-sm)] bg-control-bg-selected" />
				</div>
			</div>
		</div>
	);
}

function TabChip({
	id,
	controls,
	label,
	active,
	answered,
	onClick,
}: {
	id: string;
	controls: string;
	label: string;
	active: boolean;
	answered: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			id={id}
			aria-controls={controls}
			aria-selected={active}
			tabIndex={active ? 0 : -1}
			data-testid="ask-tab"
			data-active={active}
			data-answered={answered}
			onClick={onClick}
			className={cn(
				"flex shrink-0 items-center gap-xs whitespace-nowrap rounded-full px-sm py-0.5 tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary",
				active ? "bg-primary-subtle text-primary" : "text-text-muted hover:bg-control-bg-hovered",
			)}
		>
			<span
				className={cn(
					"flex size-3.5 items-center justify-center rounded-full border",
					answered ? "border-primary text-primary" : "border-border-default",
				)}
			>
				{answered ? <Check className="size-2.5" /> : null}
			</span>
			{label}
		</button>
	);
}

function ModeHint({
	question,
	review,
	multipleQuestions,
	noteAvailable,
}: {
	question: AskUserQuestionItem | undefined;
	review: boolean;
	multipleQuestions: boolean;
	noteAvailable: boolean;
}) {
	if (review) {
		return (
			<span
				data-testid="ask-shortcuts"
				className="flex items-center gap-xs text-text-muted tr-text-metadata"
			>
				<ListChecks className="size-3.5 shrink-0" />
				Review · ←→ questions · Enter submit · Shift+Esc skip · Tab actions
			</span>
		);
	}
	const multiSelect = !!question?.multiSelect;
	return (
		<span
			data-testid="ask-shortcuts"
			className="flex flex-wrap items-center gap-xs text-text-muted tr-text-metadata"
		>
			{multiSelect ? (
				<ListChecks className="size-3.5 shrink-0" />
			) : (
				<CircleDot className="size-3.5 shrink-0" />
			)}
			<span>{multiSelect ? "↑↓ move incl. Other" : "↑↓ move & select"}</span>
			<span>· Space {multiSelect ? "toggle" : "select"}</span>
			<span>· Enter confirm</span>
			<span>· Tab {noteAvailable ? "note/actions" : "actions"}</span>
			<span>· Shift+Esc skip</span>
			{multipleQuestions ? <span>· ←→ questions</span> : null}
		</span>
	);
}
