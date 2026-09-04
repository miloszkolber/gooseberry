import {
	ACCEPTED_IMAGE_TYPES,
	ACCEPTED_TEXT_ATTACHMENT_EXTENSIONS,
	REQUEST_IMAGE_BASE64_BUDGET,
	type SlashCommandInfo,
	utf8ByteLength,
	validateTextResourceAttachments,
} from "@gooseberry/contracts";
import {
	ArrowUp,
	BookOpen,
	Bot,
	ChevronUp,
	FileIcon,
	FolderIcon,
	History,
	Paperclip,
	Puzzle,
	Square,
	Wrench,
	X,
} from "lucide-react";
import {
	type ClipboardEvent,
	type DragEvent,
	forwardRef,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { randomId } from "@/lib";
import type { ChatAttachment } from "../runtime/types";
import { FileChip } from "./file-chip";
import { type AttachedImage, fileToAttachedImage } from "./image-attachment";
import {
	SlashCommandMenu,
	selectedSlashCommandValue,
	useSlashCommandCompletion,
} from "./slash-command-completion";
import { fileToTextResource } from "./text-attachment";

export type SubmitBehavior = "send" | "steer" | "queue" | "interrupt";

export function streamingSubmitBehavior(supportsSteer: boolean): "steer" | "queue" {
	return supportsSteer ? "steer" : "queue";
}

const STREAMING_SEND_MODES = [
	{
		behavior: "queue" as const,
		name: "Queue follow-up",
		meaning: "runs after the agent finishes",
		keys: "Cmd/Ctrl+Enter",
		testid: "send-mode-queue",
	},
	{
		behavior: "steer" as const,
		name: "Steer",
		meaning: "delivers at the agent's next step",
		keys: "Enter",
		testid: "send-mode-steer",
	},
	{
		behavior: "interrupt" as const,
		name: "Interrupt",
		meaning: "stops the current response and sends now",
		keys: "Cmd/Ctrl+Shift+Enter",
		testid: "send-mode-interrupt",
	},
];

export function streamingSendModes(supportsSteer: boolean) {
	return supportsSteer
		? STREAMING_SEND_MODES
		: STREAMING_SEND_MODES.filter((mode) => mode.behavior !== "steer");
}

export type MentionCandidate =
	| { path: string; name: string; kind: "file" | "dir" }
	| {
			name: string;
			description: string;
			sourceType: "skill" | "builtinSkill" | "recipe" | "subrecipe" | "agent" | "project";
			mention: string;
			kind: "agent";
	  };

export function insertedMention(candidate: MentionCandidate): string {
	return candidate.kind === "agent"
		? candidate.mention
		: candidate.kind === "dir"
			? `@${candidate.path}/`
			: `@${candidate.path}`;
}

export function agentMentionLabel(candidate: Extract<MentionCandidate, { kind: "agent" }>): string {
	return `${agentMentionTypeLabel(candidate.sourceType)} mention: ${candidate.name}. ${candidate.description}`;
}

export function agentMentionSummary(
	candidate: Extract<MentionCandidate, { kind: "agent" }>,
): string {
	return `${agentMentionTypeLabel(candidate.sourceType)} · ${candidate.description}`;
}

export function agentMentionTypeLabel(
	sourceType: Extract<MentionCandidate, { kind: "agent" }>["sourceType"],
): string {
	return {
		skill: "skill",
		builtinSkill: "built-in skill",
		recipe: "recipe",
		subrecipe: "subrecipe",
		agent: "agent",
		project: "project",
	}[sourceType];
}

function AgentMentionIcon({
	sourceType,
}: {
	sourceType: Extract<MentionCandidate, { kind: "agent" }>["sourceType"];
}) {
	const props = { className: "size-3.5 shrink-0", "aria-hidden": true };
	if (sourceType === "skill" || sourceType === "builtinSkill") return <Wrench {...props} />;
	if (sourceType === "recipe" || sourceType === "subrecipe") return <BookOpen {...props} />;
	if (sourceType === "project") return <Puzzle {...props} />;
	return <Bot {...props} />;
}

export function clampedMentionActiveIndex(activeIndex: number, candidateCount: number): number {
	return candidateCount > 0 ? Math.min(Math.max(activeIndex, 0), candidateCount - 1) : 0;
}

export type MentionCompletionKeyAction =
	| { type: "none" }
	| { type: "move"; index: number }
	| { type: "select"; index: number }
	| { type: "dismiss" };

export function mentionCompletionKeyAction(
	key: string,
	open: boolean,
	activeIndex: number,
	candidateCount: number,
): MentionCompletionKeyAction {
	if (!open || candidateCount === 0) return { type: "none" };
	const visibleIndex = clampedMentionActiveIndex(activeIndex, candidateCount);
	if (key === "ArrowDown") return { type: "move", index: (visibleIndex + 1) % candidateCount };
	if (key === "ArrowUp") {
		return { type: "move", index: (visibleIndex - 1 + candidateCount) % candidateCount };
	}
	if (key === "Enter" || key === "Tab") return { type: "select", index: visibleIndex };
	if (key === "Escape") return { type: "dismiss" };
	return { type: "none" };
}

interface PendingImage extends AttachedImage {
	id: string;
	name: string;
	tag?: string;
}

interface PendingText {
	id: string;
	name: string;
	content: Extract<ChatAttachment, { kind: "text" }>["content"];
}

interface AttachError {
	id: string;
	name: string;
	reason: string;
}

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
};

const GENERIC_CLIPBOARD_IMAGE_NAMES = new Set([
	"",
	"clipboard",
	"clipboard image",
	"image",
	"image.png",
	"image.jpg",
	"image.jpeg",
	"image.gif",
	"image.webp",
]);

export function imageAttachmentTag(name: string): string {
	return `[${name}]`;
}

export function clipboardImageName(
	name: string,
	mimeType: string,
	existingNames: readonly string[],
	draft: string,
): string {
	const sourceName = name.trim();
	const taken = (candidate: string) =>
		existingNames.includes(candidate) || draft.includes(imageAttachmentTag(candidate));
	if (GENERIC_CLIPBOARD_IMAGE_NAMES.has(sourceName.toLowerCase())) {
		const extension = IMAGE_EXTENSION_BY_MIME[mimeType] ?? "png";
		for (let index = 1; ; index += 1) {
			const candidate = `image-${index}.${extension}`;
			const sequence = `image-${index}.`;
			const sequenceTaken =
				existingNames.some((existingName) => existingName.startsWith(sequence)) ||
				draft.includes(`[${sequence}`);
			if (!taken(candidate) && !sequenceTaken) return candidate;
		}
	}
	if (!taken(sourceName)) return sourceName;
	const dot = sourceName.lastIndexOf(".");
	const stem = dot > 0 ? sourceName.slice(0, dot) : sourceName;
	const extension = dot > 0 ? sourceName.slice(dot) : "";
	for (let index = 2; ; index += 1) {
		const candidate = `${stem}-${index}${extension}`;
		if (!taken(candidate)) return candidate;
	}
}

export function insertImageTags(
	value: string,
	selectionStart: number,
	selectionEnd: number,
	names: readonly string[],
): { value: string; caret: number } {
	if (names.length === 0) return { value, caret: selectionStart };
	const before = value.slice(0, selectionStart);
	const after = value.slice(selectionEnd);
	const tags = names.map(imageAttachmentTag).join(" ");
	const beforeSpace = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const afterSpace = after.length > 0 && !/^\s/.test(after) ? " " : "";
	const inserted = `${beforeSpace}${tags}${afterSpace}`;
	return {
		value: `${before}${inserted}${after}`,
		caret: before.length + inserted.length,
	};
}

export function removeImageTag(value: string, name: string): string {
	const tag = imageAttachmentTag(name);
	const index = value.indexOf(tag);
	return index < 0 ? value : `${value.slice(0, index)}${value.slice(index + tag.length)}`;
}

export function removeImageTags(
	value: string,
	caret: number,
	names: readonly string[],
): { value: string; caret: number } {
	let nextValue = value;
	let nextCaret = caret;
	for (const name of names) {
		const tag = imageAttachmentTag(name);
		const index = nextValue.indexOf(tag);
		if (index < 0) continue;
		nextValue = `${nextValue.slice(0, index)}${nextValue.slice(index + tag.length)}`;
		if (nextCaret > index) nextCaret = Math.max(index, nextCaret - tag.length);
	}
	return { value: nextValue, caret: nextCaret };
}

export function reserveClipboardImageNames(
	files: readonly Pick<File, "name" | "type">[],
	existingNames: readonly string[],
	draft: string,
): string[] {
	const occupiedNames = [...existingNames];
	return files.map((file) => {
		const name = clipboardImageName(file.name, file.type, occupiedNames, draft);
		occupiedNames.push(name);
		return name;
	});
}

function activeToken(value: string, caret: number): { token: string; start: number } {
	const match = /(\S+)$/.exec(value.slice(0, caret));
	if (!match) return { token: "", start: caret };
	return { token: match[0], start: caret - match[0].length };
}

interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	isStreaming: boolean;
	commands: SlashCommandInfo[];
	mentionCandidates: MentionCandidate[];
	recentPrompts: string[];
	onMentionQuery: (query: string | null) => void;
	onSubmit: (
		text: string,
		attachments: ChatAttachment[],
		behavior: SubmitBehavior,
	) => boolean | undefined;
	onAbort: () => void;
	onHistoryOpen?: () => void;
	supportsImages?: boolean | null;
	supportsTextResources?: boolean | null;
	supportsSteer?: boolean;
}

export interface ComposerHandle {
	insertText: (text: string) => void;
	insertAndSubmit: (text: string, behavior: SubmitBehavior) => void;
	openHistory: () => void;
	refocus: () => void;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
	{
		value,
		onChange,
		isStreaming,
		commands,
		mentionCandidates,
		recentPrompts,
		onMentionQuery,
		onSubmit,
		onAbort,
		onHistoryOpen,
		supportsImages = true,
		supportsTextResources = true,
		supportsSteer = true,
	},
	handleRef,
) {
	const ref = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const draftRef = useRef(value);
	draftRef.current = value;
	const [caret, setCaret] = useState(value.length);
	const caretRef = useRef(value.length);
	const [images, setImages] = useState<PendingImage[]>([]);
	const [texts, setTexts] = useState<PendingText[]>([]);
	const imagesRef = useRef<PendingImage[]>([]);
	const reservedImageNamesRef = useRef<string[]>([]);
	const supportsImagesRef = useRef(supportsImages);
	supportsImagesRef.current = supportsImages;
	const textsRef = useRef<PendingText[]>([]);
	const supportsTextResourcesRef = useRef(supportsTextResources);
	supportsTextResourcesRef.current = supportsTextResources;
	const imagePromptsEnabled = supportsImages !== false;
	const textResourcesEnabled = supportsTextResources !== false;
	const attachmentPromptsEnabled = imagePromptsEnabled || textResourcesEnabled;
	const commitImages = (next: PendingImage[]) => {
		imagesRef.current = next;
		setImages(next);
	};
	const commitTexts = (next: PendingText[]) => {
		textsRef.current = next;
		setTexts(next);
	};
	const [pendingAttachments, setPendingAttachments] = useState(0);
	const [attachErrors, setAttachErrors] = useState<AttachError[]>([]);
	const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
	const [mentionDismissed, setMentionDismissed] = useState(false);
	const [sendMenuOpen, setSendMenuOpen] = useState(false);
	const recallIdxRef = useRef<number | null>(null);

	const { token, start } = activeToken(value, caret);
	const mentionQuery = token.startsWith("@") ? token.slice(1) : null;

	useEffect(() => onMentionQuery(mentionQuery), [mentionQuery, onMentionQuery]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the query changes
	useEffect(() => {
		setMentionActiveIndex(0);
		setMentionDismissed(false);
	}, [mentionQuery]);
	useEffect(() => {
		setMentionActiveIndex((index) => clampedMentionActiveIndex(index, mentionCandidates.length));
	}, [mentionCandidates.length]);
	useEffect(() => {
		if (supportsImages !== false) return;
		const removedImages = imagesRef.current.length > 0;
		imagesRef.current = [];
		setImages([]);
		if (removedImages) {
			setAttachErrors([
				{
					id: randomId(),
					name: "images",
					reason: "connected agent does not support image prompts",
				},
			]);
		}
	}, [supportsImages]);
	useEffect(() => {
		if (supportsTextResources !== false) return;
		const removedTexts = textsRef.current.length > 0;
		textsRef.current = [];
		setTexts([]);
		if (removedTexts) {
			setAttachErrors([
				{
					id: randomId(),
					name: "text files",
					reason: "connected agent does not support text resource prompts",
				},
			]);
		}
	}, [supportsTextResources]);

	const mentionOpen = !mentionDismissed && mentionQuery !== null && mentionCandidates.length > 0;
	const visibleMentionActiveIndex = clampedMentionActiveIndex(
		mentionActiveIndex,
		mentionCandidates.length,
	);
	const mentionListboxId = useId();
	const slashListboxId = useId();

	const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(
		null,
	);

	useLayoutEffect(() => {
		if (pendingSelection === null) return;
		const el = ref.current;
		if (el) {
			el.focus();
			el.setSelectionRange(pendingSelection.start, pendingSelection.end);
		}
		caretRef.current = pendingSelection.start;
		setCaret(pendingSelection.start);
		setPendingSelection(null);
	}, [pendingSelection]);

	const focusSelection = useCallback((start: number, end: number = start) => {
		setPendingSelection({ start, end });
	}, []);

	const replaceDraft = useCallback(
		(text: string, caret: number = text.length) => {
			recallIdxRef.current = null;
			draftRef.current = text;
			onChange(text);
			caretRef.current = caret;
			focusSelection(caret);
		},
		[onChange, focusSelection],
	);

	const canSubmit = (raw: string) =>
		pendingAttachments === 0 &&
		(!!raw.trim() ||
			(imagePromptsEnabled && images.length > 0) ||
			(textResourcesEnabled && texts.length > 0));

	const submitText = (raw: string, behavior: SubmitBehavior) => {
		if (!canSubmit(raw)) return;
		const text = raw.trim();
		const accepted = onSubmit(
			text,
			[
				...(imagePromptsEnabled
					? images.map(({ name, content }) => ({ kind: "image" as const, name, content }))
					: []),
				...(textResourcesEnabled
					? texts.map(({ name, content }) => ({ kind: "text" as const, name, content }))
					: []),
			],
			behavior,
		);
		if (accepted === false) return;
		draftRef.current = "";
		caretRef.current = 0;
		onChange("");
		commitImages([]);
		commitTexts([]);
		setAttachErrors([]);
		recallIdxRef.current = null;
	};

	const pickMention = (c: MentionCandidate) => {
		const before = value.slice(0, start);
		const after = value.slice(caret);
		const insert = insertedMention(c);
		const suffix = c.kind === "dir" ? "" : " ";
		replaceDraft(
			`${before}${insert}${suffix}${after}`,
			before.length + insert.length + suffix.length,
		);
	};

	const slashCompletion = useSlashCommandCompletion({
		value,
		commands,
		onSelect: (command) => replaceDraft(selectedSlashCommandValue(command)),
	});
	const completionOpen = mentionOpen || slashCompletion.open;
	const activeCompletionId = mentionOpen
		? `${mentionListboxId}-option-${visibleMentionActiveIndex}`
		: slashCompletion.open
			? `${slashListboxId}-option-${slashCompletion.activeIndex}`
			: undefined;
	const completionListboxId = mentionOpen ? mentionListboxId : slashListboxId;

	const openHistory = () => {
		setMentionDismissed(true);
		slashCompletion.dismiss();
		onHistoryOpen?.();
	};

	useImperativeHandle(handleRef, () => ({
		insertText: (text: string) => replaceDraft(text),
		insertAndSubmit: (text: string, behavior: SubmitBehavior) =>
			canSubmit(text) ? submitText(text, behavior) : replaceDraft(text),
		openHistory,
		refocus: () => {
			focusSelection(caret);
		},
	}));

	const addFiles = async (files: File[], reservedImageNames?: readonly string[]) => {
		const imageFiles = files.filter((file) => file.type.startsWith("image/"));
		const textFiles = files.filter(
			(file) => !file.type.startsWith("image/") && file.name.includes("."),
		);
		const unsupported = files.filter(
			(file) => !imageFiles.includes(file) && !textFiles.includes(file),
		);
		if (files.length === 0) return;
		setPendingAttachments((n) => n + files.length);
		try {
			const [imageResults, textResults] = await Promise.all([
				Promise.allSettled(imageFiles.map(fileToAttachedImage)),
				Promise.allSettled(textFiles.map(fileToTextResource)),
			]);
			let used = imagesRef.current.reduce((sum, p) => sum + p.content.data.length, 0);
			const additions: PendingImage[] = [];
			const imageNames = [
				...imagesRef.current.map((image) => image.name),
				...textsRef.current.map((attachment) => attachment.name),
			];
			const textAdditions: PendingText[] = [];
			const errors: AttachError[] = [];
			const failedImageNames: string[] = [];
			imageResults.forEach((result, i) => {
				const file = imageFiles[i];
				const name = reservedImageNames?.[i] ?? (file?.name || "image");
				if (supportsImagesRef.current === false) {
					errors.push({
						id: randomId(),
						name,
						reason: "connected agent does not support image prompts",
					});
					if (reservedImageNames) failedImageNames.push(name);
					return;
				}
				if (result.status !== "fulfilled" || result.value === null) {
					errors.push({ id: randomId(), name, reason: "unsupported image format" });
					if (reservedImageNames) failedImageNames.push(name);
					return;
				}
				const size = result.value.content.data.length;
				if (used + size > REQUEST_IMAGE_BASE64_BUDGET) {
					errors.push({ id: randomId(), name, reason: "message image limit reached" });
					if (reservedImageNames) failedImageNames.push(name);
					return;
				}
				used += size;
				imageNames.push(name);
				additions.push({
					id: randomId(),
					name,
					...(reservedImageNames ? { tag: imageAttachmentTag(name) } : {}),
					...result.value,
				});
			});
			textResults.forEach((result, i) => {
				const name = textFiles[i]?.name || "file";
				if (supportsTextResourcesRef.current === false) {
					errors.push({
						id: randomId(),
						name,
						reason: "connected agent does not support text resource prompts",
					});
					return;
				}
				if (result.status !== "fulfilled") {
					errors.push({
						id: randomId(),
						name,
						reason:
							result.reason instanceof Error ? result.reason.message : "unsupported text file",
					});
					return;
				}
				try {
					validateTextResourceAttachments([
						...textsRef.current.map((attachment) => attachment.content),
						...textAdditions.map((attachment) => attachment.content),
						result.value,
					]);
				} catch (error) {
					errors.push({
						id: randomId(),
						name,
						reason:
							error instanceof Error ? error.message : "message text attachment limit reached",
					});
					return;
				}
				textAdditions.push({ id: randomId(), name, content: result.value });
			});
			unsupported.forEach((file) => {
				errors.push({
					id: randomId(),
					name: file.name || "file",
					reason: "supported image or text file required",
				});
			});
			if (supportsImagesRef.current !== false && additions.length > 0) {
				commitImages([...imagesRef.current, ...additions]);
			}
			if (failedImageNames.length > 0) {
				const removal = removeImageTags(draftRef.current, caretRef.current, failedImageNames);
				replaceDraft(removal.value, removal.caret);
			}
			if (supportsTextResourcesRef.current !== false && textAdditions.length > 0) {
				commitTexts([...textsRef.current, ...textAdditions]);
			}
			if (errors.length > 0) {
				setAttachErrors((prev) => [...prev, ...errors]);
			}
		} finally {
			if (reservedImageNames) {
				reservedImageNamesRef.current = reservedImageNamesRef.current.filter(
					(name) => !reservedImageNames.includes(name),
				);
			}
			setPendingAttachments((n) => n - files.length);
		}
	};

	const removeImage = (image: PendingImage) => {
		commitImages(imagesRef.current.filter((current) => current.id !== image.id));
		if (!image.tag) return;
		const removal = removeImageTags(draftRef.current, caretRef.current, [image.name]);
		if (removal.value !== draftRef.current) replaceDraft(removal.value, removal.caret);
	};

	const submit = (behavior: SubmitBehavior) => {
		submitText(value, behavior);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (mentionOpen) {
			const action = mentionCompletionKeyAction(
				e.key,
				mentionOpen,
				visibleMentionActiveIndex,
				mentionCandidates.length,
			);
			if (action.type !== "none") {
				e.preventDefault();
				if (action.type === "move") setMentionActiveIndex(action.index);
				if (action.type === "dismiss") setMentionDismissed(true);
				if (action.type === "select") {
					const candidate = mentionCandidates[action.index];
					if (candidate) pickMention(candidate);
				}
				return;
			}
		}
		if (slashCompletion.handleKeyDown(e)) return;
		const recallAt = recallIdxRef.current;
		if (e.key === "ArrowUp" && (value === "" || recallAt !== null) && recentPrompts.length > 0) {
			e.preventDefault();
			const next = recallAt === null ? 0 : Math.min(recallAt + 1, recentPrompts.length - 1);
			const text = recentPrompts[next] ?? "";
			recallIdxRef.current = next;
			draftRef.current = text;
			caretRef.current = text.length;
			onChange(text);
			focusSelection(text.length);
			return;
		}
		if (e.key === "ArrowDown" && recallAt !== null) {
			e.preventDefault();
			if (recallAt === 0) {
				recallIdxRef.current = null;
				draftRef.current = "";
				caretRef.current = 0;
				onChange("");
				focusSelection(0);
			} else {
				const next = recallAt - 1;
				const text = recentPrompts[next] ?? "";
				recallIdxRef.current = next;
				draftRef.current = text;
				caretRef.current = text.length;
				onChange(text);
				focusSelection(text.length);
			}
			return;
		}
		if (e.key === "Enter" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			submit(isStreaming ? "interrupt" : "send");
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			submit(isStreaming ? "queue" : "send");
			return;
		}
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			const behavior: SubmitBehavior = isStreaming
				? streamingSubmitBehavior(supportsSteer)
				: "send";
			submit(behavior);
		}
	};

	const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files = [...e.clipboardData.files];
		const imageFiles = files.filter((file) => file.type.startsWith("image/"));
		if (imageFiles.length === 0) return;
		if (attachmentPromptsEnabled) {
			e.preventDefault();
			const eventValue = e.currentTarget.value;
			const selectionStart =
				eventValue === draftRef.current ? e.currentTarget.selectionStart : caretRef.current;
			const selectionEnd =
				eventValue === draftRef.current ? e.currentTarget.selectionEnd : caretRef.current;
			const reservedNames = reserveClipboardImageNames(
				imageFiles,
				[
					...imagesRef.current.map((image) => image.name),
					...textsRef.current.map((attachment) => attachment.name),
					...reservedImageNamesRef.current,
				],
				draftRef.current,
			);
			reservedImageNamesRef.current.push(...reservedNames);
			const insertion = insertImageTags(
				draftRef.current,
				selectionStart,
				selectionEnd,
				reservedNames,
			);
			replaceDraft(insertion.value, insertion.caret);
			void addFiles(files, reservedNames);
		} else {
			e.preventDefault();
			setAttachErrors([
				{
					id: randomId(),
					name: "clipboard image",
					reason: "connected agent does not support file attachments",
				},
			]);
		}
	};

	const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
		if (e.dataTransfer.files.length > 0) {
			e.preventDefault();
			if (attachmentPromptsEnabled) {
				void addFiles([...e.dataTransfer.files]);
			} else {
				setAttachErrors([
					{
						id: randomId(),
						name: "dropped image",
						reason: "connected agent does not support file attachments",
					},
				]);
			}
		}
	};

	return (
		<div
			className="relative flex shrink-0 flex-col border-border-muted border-t bg-container-project-bg"
			data-image-prompts={supportsImages === null ? "unknown" : supportsImages}
			data-text-resource-prompts={
				supportsTextResources === null ? "unknown" : supportsTextResources
			}
		>
			{mentionOpen ? (
				<div
					id={mentionListboxId}
					role="listbox"
					data-testid="mention-menu"
					className="absolute bottom-full left-sm mb-xs max-h-[40vh] w-[min(28rem,90%)] overflow-y-auto rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg p-xs shadow-[var(--shadow-md)]"
				>
					{mentionCandidates.map((candidate, index) => (
						<button
							key={candidate.kind === "agent" ? candidate.mention : candidate.path}
							id={`${mentionListboxId}-option-${index}`}
							role="option"
							aria-selected={index === visibleMentionActiveIndex}
							type="button"
							data-testid="mention-item"
							aria-label={candidate.kind === "agent" ? agentMentionLabel(candidate) : undefined}
							onClick={() => pickMention(candidate)}
							className={`flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left tr-text-ui ${index === visibleMentionActiveIndex ? "bg-control-bg-selected text-text-default" : "text-text-muted"}`}
						>
							{candidate.kind === "agent" ? (
								<AgentMentionIcon sourceType={candidate.sourceType} />
							) : candidate.kind === "dir" ? (
								<FolderIcon className="size-3.5 shrink-0" />
							) : (
								<FileIcon className="size-3.5 shrink-0" />
							)}
							{candidate.kind === "agent" ? (
								<span className="min-w-0">
									<span className="block truncate">{candidate.name}</span>
									<span className="block truncate text-text-muted tr-text-metadata">
										{agentMentionSummary(candidate)}
									</span>
								</span>
							) : (
								<span className="truncate">{candidate.path}</span>
							)}
						</button>
					))}
				</div>
			) : slashCompletion.open ? (
				<SlashCommandMenu
					commands={slashCompletion.matches}
					activeIndex={slashCompletion.activeIndex}
					onSelect={slashCompletion.pick}
					className="absolute bottom-full left-sm mb-xs"
					listboxId={slashListboxId}
				/>
			) : null}

			{(imagePromptsEnabled && images.length > 0) ||
			(textResourcesEnabled && texts.length > 0) ||
			pendingAttachments > 0 ||
			attachErrors.length > 0 ? (
				<div className="flex flex-wrap gap-xs px-sm pt-sm" data-testid="composer-attachments">
					{attachErrors.map((err) => (
						<FileChip
							key={err.id}
							data-testid="composer-image-error"
							tone="error"
							icon={false}
							title={`Couldn't attach ${err.name} — ${err.reason}`}
							label={`Couldn't attach ${err.name}`}
							meta={`— ${err.reason}`}
							trailing={
								<button
									type="button"
									aria-label="Dismiss"
									onClick={() => setAttachErrors((prev) => prev.filter((p) => p.id !== err.id))}
									className="hover:opacity-80"
								>
									<X className="size-3" />
								</button>
							}
						/>
					))}
					{images.map((img) => (
						<FileChip
							key={img.id}
							data-testid="composer-image"
							data-width={img.width}
							data-height={img.height}
							data-mime={img.content.mimeType}
							title={img.name}
							label={img.name}
							meta={img.width && img.height ? ` · ${img.width}×${img.height}` : undefined}
							trailing={
								<button
									type="button"
									aria-label="Remove image"
									onClick={() => removeImage(img)}
									className="text-text-muted hover:text-text-default"
								>
									<X className="size-3" />
								</button>
							}
						/>
					))}
					{texts.map((attachment) => (
						<FileChip
							key={attachment.id}
							data-testid="composer-text-attachment"
							title={attachment.name}
							label={attachment.name}
							meta={` · ${utf8ByteLength(attachment.content.text).toLocaleString()} bytes`}
							trailing={
								<button
									type="button"
									aria-label="Remove file"
									onClick={() =>
										commitTexts(textsRef.current.filter((p) => p.id !== attachment.id))
									}
									className="text-text-muted hover:text-text-default"
								>
									<X className="size-3" />
								</button>
							}
						/>
					))}
					{pendingAttachments > 0 ? (
						<FileChip
							data-testid="composer-attachment-pending"
							label={
								<span className="text-text-muted">
									{pendingAttachments === 1 ? "Attaching…" : `Attaching ${pendingAttachments}…`}
								</span>
							}
						/>
					) : null}
				</div>
			) : null}

			<div className="flex flex-col gap-sm p-sm">
				<div className="relative rounded-[var(--radius-md)] border border-control-border-default bg-control-bg bg-clip-padding transition-colors focus-within:border-control-border-active">
					<textarea
						ref={ref}
						data-testid="chat-input"
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={completionOpen}
						aria-controls={completionOpen ? completionListboxId : undefined}
						aria-activedescendant={activeCompletionId}
						value={value}
						onChange={(e) => {
							const next = e.target.value;
							const nextCaret = e.target.selectionStart;
							const recalled = recallIdxRef.current;
							if (recalled !== null && next !== recentPrompts[recalled]) {
								recallIdxRef.current = null;
							}
							draftRef.current = next;
							onChange(next);
							caretRef.current = nextCaret;
							setCaret(nextCaret);
						}}
						onKeyUp={(e) => {
							caretRef.current = e.currentTarget.selectionStart;
							setCaret(e.currentTarget.selectionStart);
						}}
						onClick={(e) => {
							caretRef.current = e.currentTarget.selectionStart;
							setCaret(e.currentTarget.selectionStart);
						}}
						onKeyDown={onKeyDown}
						onPaste={onPaste}
						onDrop={onDrop}
						rows={4}
						placeholder={
							isStreaming
								? supportsSteer
									? "Enter steers at the next step · Cmd/Ctrl+Enter queues for when it finishes"
									: "Enter queues a follow-up for when the agent finishes"
								: "Message the agent…  (@ files · / commands · Enter to send)"
						}
						className="relative min-h-[108px] w-full resize-none rounded-[var(--radius-sm)] bg-transparent px-md py-sm tr-text-ui text-text-default outline-none placeholder:text-text-muted"
					/>
				</div>
				<div className="flex flex-wrap items-center gap-sm">
					<div className="min-w-0 flex-1" />
					<div className="flex shrink-0 items-center gap-sm">
						<input
							ref={fileInputRef}
							type="file"
							accept={[
								...ACCEPTED_IMAGE_TYPES,
								...ACCEPTED_TEXT_ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`),
							].join(",")}
							multiple
							tabIndex={-1}
							aria-hidden="true"
							className="sr-only"
							onChange={(event) => {
								const files = [...(event.currentTarget.files ?? [])];
								event.currentTarget.value = "";
								void addFiles(files);
							}}
						/>
						<button
							type="button"
							data-testid="file-attach"
							aria-label="Attach files or images"
							title="Attach files or images"
							disabled={!attachmentPromptsEnabled}
							onClick={() => fileInputRef.current?.click()}
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg text-text-default hover:bg-control-bg-hovered disabled:pointer-events-none disabled:text-text-muted"
						>
							<Paperclip className="size-3.5" />
						</button>
						<button
							type="button"
							data-testid="history-open"
							aria-label="Search history"
							onClick={openHistory}
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg text-text-default hover:bg-control-bg-hovered"
						>
							<History className="size-3.5" />
						</button>
						{isStreaming ? (
							<button
								type="button"
								data-testid="chat-abort"
								aria-label="Stop"
								onClick={onAbort}
								className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg text-text-default hover:bg-control-bg-hovered"
							>
								<Square className="size-3.5" />
							</button>
						) : null}
						{isStreaming ? (
							<Popover open={sendMenuOpen} onOpenChange={setSendMenuOpen}>
								<PopoverTrigger asChild>
									<button
										type="button"
										data-testid="send-menu"
										aria-label="Send options"
										className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg text-text-default hover:bg-control-bg-hovered"
									>
										<ChevronUp className="size-3.5" />
									</button>
								</PopoverTrigger>
								<PopoverContent side="top" align="end" className="w-[320px] p-xs">
									<div className="flex flex-col gap-2xs">
										{streamingSendModes(supportsSteer).map((mode) => (
											<button
												key={mode.behavior}
												type="button"
												data-testid={mode.testid}
												disabled={!canSubmit(value)}
												onClick={() => {
													setSendMenuOpen(false);
													submit(mode.behavior);
												}}
												className="flex w-full flex-col gap-2xs rounded-[var(--radius-sm)] px-sm py-xs text-left hover:bg-control-bg-hovered disabled:pointer-events-none disabled:opacity-50"
											>
												<span className="flex w-full items-baseline justify-between gap-sm">
													<span className="text-text-default tr-text-ui">{mode.name}</span>
													<span className="shrink-0 text-text-muted tr-text-metadata">
														{mode.keys}
													</span>
												</span>
												<span className="text-text-muted tr-text-metadata">{mode.meaning}</span>
											</button>
										))}
									</div>
								</PopoverContent>
							</Popover>
						) : null}
						<button
							type="button"
							data-testid="chat-send"
							aria-label={isStreaming ? (supportsSteer ? "Steer" : "Queue follow-up") : "Send"}
							onClick={() => submit(isStreaming ? streamingSubmitBehavior(supportsSteer) : "send")}
							disabled={!canSubmit(value)}
							className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-primary-bg text-control-primary-text hover:bg-control-primary-bg-hovered disabled:pointer-events-none disabled:bg-control-primary-disabled-bg disabled:text-control-primary-disabled-text"
						>
							<ArrowUp className="size-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
});
