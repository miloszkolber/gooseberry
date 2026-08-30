import { useMemo } from "react";
import { Markdown } from "../chat/markdown";
import { stripFrontmatter } from "../lib/utils";
import { alertComponents, remarkGithubAlerts } from "./markdown-alerts";
import { documentComponents, remarkHeadingIds } from "./markdown-links";

const DOCUMENT_PROSE = [
	"tr-prose-doc max-w-none break-words text-pretty text-text-default",
	"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
	"[&_h1]:mt-0 [&_h1]:mb-md [&_h1]:border-border-default [&_h1]:border-b [&_h1]:pb-xs [&_h1]:text-balance",
	"[&_h2]:mt-xl [&_h2]:mb-md [&_h2]:border-border-default [&_h2]:border-b [&_h2]:pb-xs [&_h2]:text-balance",
	"[&_h3]:mt-lg [&_h3]:mb-sm [&_h3]:text-balance",
	"[&_h4]:mt-lg [&_h4]:mb-sm [&_h4]:text-balance",
	"[&_h5]:mt-md [&_h5]:mb-xs",
	"[&_h6]:mt-md [&_h6]:mb-xs [&_h6]:text-text-muted",
	"[&_p]:my-md [&_strong]:text-text-default",
	"[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary-muted hover:[&_a]:decoration-primary",
	"[&_ul]:my-md [&_ul]:list-disc [&_ul]:pl-[1.6em] [&_ol]:my-md [&_ol]:list-decimal [&_ol]:pl-[1.6em] [&_li]:my-1",
	"[&_li>ul]:my-1 [&_li>ol]:my-1 [&_li_p]:my-1",
	"[&_.task-list-item]:list-none [&_input[type=checkbox]]:mr-xs [&_input[type=checkbox]]:accent-primary",
	"[&_blockquote]:my-md [&_blockquote]:border-primary-muted [&_blockquote]:border-l-2 [&_blockquote]:pl-md [&_blockquote]:text-text-muted [&_blockquote>:first-child]:mt-0 [&_blockquote>:last-child]:mb-0",
	"[&_hr]:my-xl [&_hr]:h-px [&_hr]:border-0 [&_hr]:bg-border-default",
	"[&_table]:my-md [&_table]:block [&_table]:w-max [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
	"[&_th]:border [&_th]:border-border-default [&_th]:bg-container-elevated-bg [&_th]:px-sm [&_th]:py-xs [&_th]:text-left",
	"[&_td]:border [&_td]:border-border-default [&_td]:px-sm [&_td]:py-xs [&_td]:align-top",
	"[&_tbody_tr:nth-child(2n)]:bg-sunken",
	"[&_pre]:my-md",
	"[&_img]:my-md [&_img]:max-w-full [&_img]:rounded-[var(--radius-sm)]",
].join(" ");

export function MarkdownDocument({
	content,
	projectAreaId,
	root,
	rootIndex,
	path,
}: {
	content: string;
	projectAreaId: string;
	root: string;
	rootIndex: number;
	path: string;
}) {
	const components = useMemo(
		() => documentComponents({ projectAreaId, root, rootIndex, path }),
		[path, projectAreaId, root, rootIndex],
	);
	return (
		<Markdown
			text={stripFrontmatter(content)}
			className={DOCUMENT_PROSE}
			remarkPlugins={[remarkGithubAlerts, remarkHeadingIds]}
			components={{ ...alertComponents, ...components }}
		/>
	);
}

export default function MarkdownPreview({
	content,
	projectAreaId,
	root,
	rootIndex,
	path,
}: {
	content: string;
	projectAreaId: string;
	root: string;
	rootIndex: number;
	path: string;
}) {
	return (
		<div data-testid="markdown-preview" className="h-full overflow-auto bg-container-project-bg">
			<article className="mx-auto max-w-[78ch] px-xl py-lg">
				<MarkdownDocument
					content={content}
					projectAreaId={projectAreaId}
					root={root}
					rootIndex={rootIndex}
					path={path}
				/>
			</article>
		</div>
	);
}
