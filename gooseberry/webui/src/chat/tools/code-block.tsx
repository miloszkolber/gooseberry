import { useEffect, useState } from "react";

export function CodeBlock({ code, lang }: { code: string; lang: string }) {
	const [highlighted, setHighlighted] = useState<{
		code: string;
		html: string;
		lang: string;
	} | null>(null);
	const html = highlighted?.code === code && highlighted.lang === lang ? highlighted.html : null;

	useEffect(() => {
		let cancelled = false;
		setHighlighted(null);
		if (!lang) {
			return;
		}
		void import("@/lib/highlighter")
			.then(({ highlightCode }) => highlightCode(code, lang))
			.then((nextHtml) => {
				if (!cancelled && nextHtml) setHighlighted({ code, html: nextHtml, lang });
			})
			.catch(() => !cancelled && setHighlighted(null));
		return () => {
			cancelled = true;
		};
	}, [code, lang]);

	if (html === null) {
		return (
			<pre className="overflow-auto rounded-[var(--radius-sm)] bg-container-header-bg p-sm tr-code-text text-text-default">
				{code}
			</pre>
		);
	}
	return (
		<div
			className="overflow-auto rounded-[var(--radius-sm)] tr-code-text [&_pre]:!m-0 [&_pre]:!bg-container-header-bg [&_pre]:p-sm"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is escaped, themed markup
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}
