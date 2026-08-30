import { useMemo } from "react";
import { simpleUnifiedDiff } from "./line-diff";
import { SourcePreview } from "./source-preview";

export function SourceDiff({
	path,
	originalPath,
	original,
	modified,
	ignoreWhitespace,
}: {
	path: string;
	originalPath?: string | undefined;
	original: string;
	modified: string;
	ignoreWhitespace: boolean;
}) {
	const content = useMemo(
		() => simpleUnifiedDiff(path, original, modified, ignoreWhitespace, originalPath),
		[ignoreWhitespace, modified, original, path, originalPath],
	);
	return <SourcePreview path={path} content={content} language="diff" testId="source-diff" />;
}
