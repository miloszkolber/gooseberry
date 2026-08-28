import { useMemo } from "react";
import { simpleUnifiedDiff } from "./line-diff";
import { SourcePreview } from "./source-preview";

export function SourceDiff({
	path,
	original,
	modified,
	ignoreWhitespace,
}: {
	path: string;
	original: string;
	modified: string;
	ignoreWhitespace: boolean;
}) {
	const content = useMemo(
		() => simpleUnifiedDiff(path, original, modified, ignoreWhitespace),
		[ignoreWhitespace, modified, original, path],
	);
	return <SourcePreview path={path} content={content} language="diff" testId="source-diff" />;
}
