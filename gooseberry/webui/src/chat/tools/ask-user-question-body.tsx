import type { AskUserQuestionItem } from "@gooseberry/contracts";
import { Check, MessageCircleQuestion, Pencil } from "lucide-react";
import { Fragment, type KeyboardEvent, useEffect, useId, useRef } from "react";
import { cn } from "@/lib";
import { Markdown } from "../render/markdown";
import {
	choiceKeyAction,
	confirmStateFor,
	customTextPatch,
	noteKeyAction,
	type QuestionState,
	readRecommendation,
	selectOptionPatch,
	splitRecommended,
	toggleMultiPatch,
} from "./ask-user-question-state";

export function QuestionBody({
	question,
	state,
	pageKeys,
	onChange,
	onConfirm,
}: {
	question: AskUserQuestionItem;
	state: QuestionState;
	pageKeys: boolean;
	onChange: (next: Partial<QuestionState>) => void;
	onConfirm: (next: QuestionState) => void;
}) {
	const choiceRefs = useRef<Array<HTMLElement | null>>([]);
	const noteRef = useRef<HTMLTextAreaElement>(null);
	const focusNoteAfterRender = useRef(false);
	const otherIndex = question.options.length;
	const choiceCount = otherIndex + 1;
	const cursor = Math.min(Math.max(state.cursor, 0), Math.max(otherIndex - 1, 0));
	const customOwnsPageFocus =
		state.customActive && (!question.multiSelect || state.multi.length === 0);
	const anyPreview = !question.multiSelect && question.options.some((option) => option.preview);
	const previewSource =
		question.options.find((option) => option.label === state.option && option.preview) ??
		question.options.find((option) => option.preview);

	useEffect(() => {
		if (!focusNoteAfterRender.current || !noteRef.current) return;
		focusNoteAfterRender.current = false;
		noteRef.current.focus({ preventScroll: true });
	});

	const openNote = (label: string, index: number) => {
		focusNoteAfterRender.current = true;
		onChange(
			question.multiSelect
				? { cursor: index, noteFor: label }
				: { cursor: index, option: label, customActive: false, noteFor: label },
		);
	};

	const onSelect = (label: string, index: number) =>
		onChange(selectOptionPatch(state, label, index));
	const onToggleMulti = (label: string, index: number) =>
		onChange(toggleMultiPatch(state, label, index));
	const onCursor = (index: number) => {
		if (index !== state.cursor) onChange({ cursor: index });
	};

	const focusChoice = (index: number) => {
		if (index < otherIndex) onCursor(index);
		choiceRefs.current[index]?.focus({ preventScroll: true });
	};

	const moveCursor = (index: number) => {
		focusChoice(index);
		const target = question.options[index];
		if (!question.multiSelect && target) onSelect(target.label, index);
	};

	const finishNote = (index: number) => {
		onChange({ noteFor: null });
		requestAnimationFrame(() => choiceRefs.current[index]?.focus({ preventScroll: true }));
	};

	const onChoiceKeyDown = (
		event: KeyboardEvent<HTMLButtonElement>,
		label: string,
		index: number,
	) => {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const action = choiceKeyAction(event.key, index, choiceCount);
		if (action.type === "none") return;
		event.preventDefault();
		if (action.type === "move") moveCursor(action.index);
		else if (action.type === "select") {
			if (question.multiSelect) onToggleMulti(label, index);
			else onSelect(label, index);
		} else if (action.type === "confirm") {
			onConfirm(
				confirmStateFor(state, !!question.multiSelect, { kind: "choice", label, cursor: index }),
			);
		}
	};

	return (
		<div className="flex flex-col gap-md">
			<div className="flex items-start gap-sm">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-text-muted" />
				<p data-testid="ask-question-text" className="tr-title-dialog text-text-default">
					{question.question}
				</p>
			</div>
			<div className={cn("grid gap-sm", anyPreview && "md:grid-cols-2")}>
				<div className="flex min-w-0 flex-col gap-sm">
					<div
						{...(question.multiSelect
							? { role: "group", "aria-label": question.question }
							: { role: "radiogroup", "aria-label": question.question })}
						className="flex flex-col gap-sm"
					>
						{question.options.map((option, index) => {
							const selected = question.multiSelect
								? state.multi.includes(option.label)
								: state.option === option.label;
							const ownsCursor = index === cursor;
							const optionText = splitRecommended(option.label).text;
							const noteText = state.notes[option.label]?.trim();
							return (
								<Fragment key={option.label}>
									<OptionRow
										buttonRef={(node) => {
											choiceRefs.current[index] = node;
										}}
										label={option.label}
										description={option.description}
										recommendedReason={option.recommendedReason}
										selected={selected}
										cursor={ownsCursor}
										pageFocus={ownsCursor && !customOwnsPageFocus}
										multi={!!question.multiSelect}
										pageKeys={pageKeys}
										onFocus={() => onCursor(index)}
										onKeyDown={(event) => onChoiceKeyDown(event, option.label, index)}
										onClick={() =>
											question.multiSelect
												? onToggleMulti(option.label, index)
												: onSelect(option.label, index)
										}
									/>
									{selected ? (
										<div className="pl-[calc(1.125rem+var(--spacing-sm))]">
											{state.noteFor === option.label ? (
												<textarea
													ref={noteRef}
													data-testid="ask-note"
													aria-label={`Note for ${optionText}`}
													aria-keyshortcuts="Enter Shift+Enter Escape"
													rows={2}
													value={state.notes[option.label] ?? ""}
													placeholder="Add a note for the model…"
													onChange={(event) =>
														onChange({
															notes: { ...state.notes, [option.label]: event.target.value },
														})
													}
													onKeyDown={(event) => {
														const action = noteKeyAction(
															event.key,
															event.shiftKey,
															event.nativeEvent.isComposing,
														);
														if (action === "none") return;
														event.stopPropagation();
														if (action === "consume") return;
														event.preventDefault();
														finishNote(index);
													}}
													className="w-full resize-none rounded-[var(--radius-sm)] border border-control-border-default bg-control-bg px-sm py-xs text-text-default tr-text-metadata outline-none focus-visible:border-control-border-active"
												/>
											) : (
												<button
													type="button"
													data-testid="ask-note-toggle"
													aria-label={`${noteText ? "Edit" : "Add"} note for ${optionText}`}
													onClick={() => openNote(option.label, index)}
													className="flex items-center gap-xs rounded-[var(--radius-sm)] text-text-muted tr-text-metadata outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
												>
													<Pencil className="size-3" />
													{noteText ? "Edit note" : "Add note"}
												</button>
											)}
										</div>
									) : null}
								</Fragment>
							);
						})}
					</div>

					<OtherOptionRow
						inputRef={(node) => {
							choiceRefs.current[otherIndex] = node;
						}}
						multi={!!question.multiSelect}
						active={state.customActive}
						text={state.customText}
						pageFocus={question.options.length === 0 || customOwnsPageFocus}
						onToggle={() => onChange({ customActive: !state.customActive })}
						onText={(text) => onChange(customTextPatch(text))}
						onMove={(key) => {
							const action = choiceKeyAction(key, otherIndex, choiceCount);
							if (action.type === "move") moveCursor(action.index);
						}}
						onConfirm={() => onConfirm(state)}
					/>
				</div>

				{anyPreview && previewSource?.preview ? (
					<div
						data-testid="ask-preview"
						className="min-w-0 overflow-auto rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs tr-text-metadata"
					>
						<div className="mb-xs text-text-muted tr-text-metadata">
							Preview · {previewSource.label}
						</div>
						<Markdown text={previewSource.preview} />
					</div>
				) : null}
			</div>
		</div>
	);
}

function OptionRow({
	buttonRef,
	label,
	description,
	recommendedReason,
	selected,
	cursor,
	pageFocus,
	multi,
	pageKeys,
	onFocus,
	onKeyDown,
	onClick,
}: {
	buttonRef: (node: HTMLButtonElement | null) => void;
	label: string;
	description: string;
	recommendedReason?: string | undefined;
	selected: boolean;
	cursor: boolean;
	pageFocus: boolean;
	multi: boolean;
	pageKeys: boolean;
	onFocus: () => void;
	onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
	onClick: () => void;
}) {
	const { text, recommended, reason } = readRecommendation({ label, recommendedReason });
	return (
		<button
			ref={buttonRef}
			type="button"
			{...(multi
				? { role: "checkbox", "aria-checked": selected }
				: { role: "radio", "aria-checked": selected })}
			aria-keyshortcuts={`ArrowUp ArrowDown Home End Space Enter${pageKeys ? " ArrowLeft ArrowRight" : ""} Shift+Escape`}
			tabIndex={cursor ? 0 : -1}
			data-testid="ask-option"
			data-selected={selected}
			data-cursor={cursor}
			data-ask-page-focus={pageFocus || undefined}
			onFocus={onFocus}
			onKeyDown={onKeyDown}
			onClick={onClick}
			className={cn(
				"flex items-start gap-sm rounded-[var(--radius-sm)] border px-md py-sm text-left outline-none transition-colors focus-visible:border-control-border-active focus-visible:ring-2 focus-visible:ring-primary",
				selected
					? "border-primary bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			<Indicator selected={selected} multi={multi} />
			<span className="flex min-w-0 flex-col gap-0.5">
				<span className="flex items-center gap-xs">
					<span data-testid="ask-option-label" className="tr-text-ui text-text-default">
						{text}
					</span>
					{recommended ? <RecommendedBadge /> : null}
				</span>
				{description ? (
					<span className="text-text-muted tr-text-metadata">{description}</span>
				) : null}
				{reason ? (
					<span
						data-testid="ask-recommended-reason"
						className="mt-0.5 text-text-muted tr-text-metadata"
					>
						<span className="tr-text-emphasis text-primary">Why:</span> {reason}
					</span>
				) : null}
			</span>
		</button>
	);
}

function OtherOptionRow({
	inputRef,
	multi,
	active,
	text,
	pageFocus,
	onToggle,
	onText,
	onMove,
	onConfirm,
}: {
	inputRef: (node: HTMLInputElement | null) => void;
	multi: boolean;
	active: boolean;
	text: string;
	pageFocus: boolean;
	onToggle: () => void;
	onText: (text: string) => void;
	onMove: (key: "ArrowUp" | "ArrowDown") => void;
	onConfirm: () => void;
}) {
	const inputId = useId();
	return (
		<label
			htmlFor={inputId}
			data-testid="ask-custom-row"
			data-selected={active}
			className={cn(
				"flex cursor-text items-center gap-sm rounded-[var(--radius-sm)] border px-md py-sm transition-colors focus-within:border-control-border-active focus-within:ring-2 focus-within:ring-primary",
				active
					? "border-primary bg-primary-subtle"
					: "border-border-default hover:bg-control-bg-hovered",
			)}
		>
			{multi ? (
				<button
					type="button"
					data-testid="ask-custom-toggle"
					aria-label={active ? "Exclude your own answer" : "Include your own answer"}
					onClick={(e) => {
						e.preventDefault();
						onToggle();
					}}
					className="flex items-center rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-primary"
				>
					<Indicator selected={active} multi className="mt-0" />
				</button>
			) : (
				<Indicator selected={active} multi={false} className="mt-0" />
			)}
			<span className="tr-text-ui text-text-default">Other</span>
			<input
				ref={inputRef}
				id={inputId}
				data-testid="ask-custom"
				data-ask-page-focus={pageFocus || undefined}
				aria-label="Other answer"
				aria-keyshortcuts="ArrowUp ArrowDown Enter Shift+Escape"
				value={text}
				placeholder="type your own answer…"
				onChange={(event) => onText(event.target.value)}
				onKeyDown={(event) => {
					if (
						(event.key === "ArrowUp" || event.key === "ArrowDown") &&
						!event.shiftKey &&
						!event.altKey &&
						!event.ctrlKey &&
						!event.metaKey
					) {
						event.preventDefault();
						onMove(event.key);
						return;
					}
					if (event.key === "Enter" && !event.nativeEvent.isComposing) {
						event.preventDefault();
						onConfirm();
					}
				}}
				className="min-w-0 flex-1 border-none bg-transparent tr-text-ui text-text-default outline-none placeholder:text-text-muted"
			/>
		</label>
	);
}

const RECOMMENDED_PILL =
	"inline-flex items-center rounded-full bg-primary-subtle px-xs py-0 tr-text-label-pill text-primary";

function RecommendedBadge() {
	return <span className={RECOMMENDED_PILL}>Recommended</span>;
}

function Indicator({
	selected,
	multi,
	className,
}: {
	selected: boolean;
	multi: boolean;
	className?: string;
}) {
	if (multi) {
		return (
			<span
				className={cn(
					"mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
					selected ? "border-primary bg-primary text-text-on-primary" : "border-border-default",
					className,
				)}
			>
				{selected ? <Check className="size-3" /> : null}
			</span>
		);
	}
	return (
		<span
			className={cn(
				"mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border",
				selected ? "border-primary" : "border-border-default",
				className,
			)}
		>
			{selected ? <span className="size-2 rounded-full bg-primary" /> : null}
		</span>
	);
}
