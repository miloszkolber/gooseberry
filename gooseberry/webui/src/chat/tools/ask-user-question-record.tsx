import type {
	AskUserQuestionAnswer,
	AskUserQuestionItem,
	AskUserQuestionResult,
} from "@gooseberry/contracts";
import { Check, MessageCircleQuestion, SkipForward } from "lucide-react";
import { cn } from "@/lib";
import { deriveRecapState, splitRecommended } from "./ask-user-question-state";

export function SupersededRecord({ questions }: { questions: AskUserQuestionItem[] }) {
	return (
		<div
			data-testid="ask-user-question"
			data-tone="superseded"
			className="flex flex-col gap-xs text-text-muted tr-text-metadata"
		>
			<div className="flex items-center gap-xs">
				<SkipForward className="size-3.5 shrink-0" />
				Superseded — you replied in chat instead of answering these.
			</div>
			{questions.map((q) => (
				<div key={q.question} className="pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted">
					{q.question}
				</div>
			))}
		</div>
	);
}

export function ReviewView({
	questions,
	answers,
	submitEnabled,
	onJump,
}: {
	questions: AskUserQuestionItem[];
	answers: AskUserQuestionAnswer[];
	submitEnabled: boolean;
	onJump: (index: number) => void;
}) {
	const byIndex = new Map(answers.map((a) => [a.questionIndex, a]));
	const unanswered = questions.map((q, i) => ({ q, i })).filter(({ i }) => !byIndex.has(i));
	return (
		<div className="flex flex-col gap-sm">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-text-muted" />
				<p data-testid="ask-review-title" className="tr-title-dialog text-text-default">
					Review your answers
				</p>
			</div>
			<ul className="flex flex-col gap-md">
				{questions.map((q, i) => (
					<li key={q.question} data-testid="ask-review-item" className="flex flex-col gap-xs">
						<span className="text-text-muted tr-text-metadata">{q.header || `Q${i + 1}`}</span>
						<QuestionRecap question={q} answer={byIndex.get(i)} variant="review" />
					</li>
				))}
			</ul>
			{unanswered.length > 0 ? (
				<button
					type="button"
					data-testid="ask-unanswered"
					data-ask-page-focus={submitEnabled ? undefined : "true"}
					onClick={() => onJump(unanswered[0]?.i ?? 0)}
					className="self-start rounded-[var(--radius-sm)] text-feedback-warning tr-text-metadata outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
				>
					⚠ Unanswered: {unanswered.map(({ q, i }) => q.header || `Q${i + 1}`).join(", ")}
				</button>
			) : null}
		</div>
	);
}

export function ResolvedRecord({
	questions,
	result,
	rawText,
}: {
	questions: AskUserQuestionItem[];
	result: AskUserQuestionResult | null;
	rawText: string;
}) {
	if (!result) {
		return (
			<div
				data-testid="ask-user-question"
				data-tone="pending"
				className="text-text-muted tr-text-metadata"
			>
				{rawText || "Question closed."}
			</div>
		);
	}
	const byIndex = new Map(result.answers.map((a) => [a.questionIndex, a]));
	return (
		<div
			data-testid="ask-user-question"
			data-tone={result.cancelled ? "skipped" : "answered"}
			className="flex flex-col gap-md"
		>
			{questions.map((q, i) => (
				<QuestionRecap key={q.question} question={q} answer={byIndex.get(i)} variant="resolved" />
			))}
			{questions.length === 0 ? (
				<div className="text-text-muted tr-text-metadata">{rawText || "Answered."}</div>
			) : null}
		</div>
	);
}

function QuestionRecap({
	question,
	answer,
	variant,
}: {
	question: AskUserQuestionItem;
	answer: AskUserQuestionAnswer | undefined;
	variant: "review" | "resolved";
}) {
	const reviewing = variant === "review";
	const { selectedLabels, customAnswer, showOptions } = deriveRecapState(answer, variant);
	const selected = new Set(selectedLabels);

	return (
		<div className="flex flex-col gap-xs">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
				<p
					data-testid={reviewing ? "ask-review-question" : undefined}
					className={cn("tr-text-ui", reviewing ? "text-text-default" : "text-text-muted")}
				>
					{question.question}
				</p>
			</div>
			{showOptions ? (
				<>
					<ul className="flex flex-col gap-0.5 pl-[calc(0.875rem+var(--spacing-sm))]">
						{question.options.map((opt) => {
							const isSel = selected.has(opt.label);
							return (
								<li
									key={opt.label}
									data-testid={reviewing ? "ask-review-option" : "ask-record-option"}
									data-selected={isSel}
									className={cn(
										"flex items-center gap-xs tr-text-ui",
										isSel ? "text-text-default" : "text-text-muted",
									)}
								>
									{isSel ? (
										<Check aria-hidden="true" className="size-3.5 shrink-0 text-feedback-success" />
									) : (
										<span
											aria-hidden="true"
											className="size-3 shrink-0 rounded-full border border-border-default"
										/>
									)}
									<span data-testid="ask-selection-status" className="sr-only">
										{isSel ? "Selected: " : "Not selected: "}
									</span>
									<span>{splitRecommended(opt.label).text}</span>
								</li>
							);
						})}
						{customAnswer ? (
							<li
								data-testid={reviewing ? "ask-review-custom" : "ask-record-custom"}
								className="flex items-center gap-xs tr-text-ui text-text-default"
							>
								<Check aria-hidden="true" className="size-3.5 shrink-0 text-feedback-success" />
								<span data-testid="ask-selection-status" className="sr-only">
									Selected custom answer:{" "}
								</span>
								<span>“{customAnswer}”</span>
							</li>
						) : null}
					</ul>
					{!answer ? (
						<div
							data-testid="ask-review-unanswered"
							className="flex items-center gap-xs pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted tr-text-metadata italic"
						>
							<SkipForward className="size-3 shrink-0" /> Not answered
						</div>
					) : null}
				</>
			) : !answer ? (
				<div className="flex items-center gap-xs pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted tr-text-metadata italic">
					<SkipForward className="size-3 shrink-0" /> No answer (skipped).
				</div>
			) : (
				<div className="flex items-center gap-xs border-border-default border-l-2 pl-sm">
					<Check aria-hidden="true" className="size-3.5 shrink-0 text-feedback-success" />
					<span data-testid="ask-selection-status" className="sr-only">
						Selected custom answer:{" "}
					</span>
					<span className="tr-text-ui text-text-default">“{answer.answer}”</span>
				</div>
			)}
			{answer?.notes ? (
				<div className="pl-[calc(0.875rem+var(--spacing-sm))] text-text-muted tr-text-metadata">
					Note: {answer.notes}
				</div>
			) : null}
		</div>
	);
}
