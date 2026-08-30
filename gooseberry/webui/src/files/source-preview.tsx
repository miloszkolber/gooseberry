import { useEffect, useState } from "react";
import { highlightCode, languageForPath } from "../lib/highlighter";

export function SourcePreview({
	path,
	content,
	language,
	testId = "source-preview",
}: {
	path: string;
	content: string;
	language?: string;
	testId?: string;
}) {
	const [html, setHtml] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setHtml(null);
		highlightCode(content, language ?? languageForPath(path))
			.then((next) => {
				if (!cancelled) setHtml(next);
			})
			.catch(() => {
				if (!cancelled) setHtml(null);
			});
		return () => {
			cancelled = true;
		};
	}, [content, language, path]);

	if (html === null) {
		return (
			<pre
				data-testid={testId}
				className="h-full overflow-auto bg-container-content-bg p-md text-text-default tr-code-document"
			>
				{content}
			</pre>
		);
	}

	return (
		<div
			data-testid={testId}
			className="h-full overflow-auto bg-container-content-bg [&_.shiki]:min-h-full [&_.shiki]:!bg-transparent [&_.shiki]:p-md [&_pre]:!m-0"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki escapes source text and returns themed markup.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
