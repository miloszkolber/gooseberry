import { expect, test } from "bun:test";
import type { DirectoryListing } from "@gooseberry/contracts";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	DirectoryPickerContents,
	type DirectoryPickerContentsProps,
	parentPath,
} from "@/workspace/directory-picker-dialog";

const listing: DirectoryListing = {
	path: "/mount/work",
	roots: ["/mount"],
	directories: [{ name: "child", path: "/mount/work/child" }],
	page: 0,
	pageSize: 100,
	hasMore: false,
	complete: true,
	warnings: [],
	cursor: null,
};

type ElementProps = { children?: ReactNode; [name: string]: unknown };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
	if (Array.isArray(node)) return node.flatMap(elements);
	if (!isValidElement(node)) return [];
	const element = node as ReactElement<ElementProps>;
	return [element, ...elements(element.props.children)];
}

function text(node: ReactNode): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join("");
	if (!isValidElement(node)) return "";
	return text((node as ReactElement<{ children?: ReactNode }>).props.children);
}

function props(
	overrides: Partial<DirectoryPickerContentsProps> = {},
): DirectoryPickerContentsProps {
	return {
		listing,
		loading: false,
		error: null,
		includeHidden: false,
		onIncludeHiddenChange: () => {},
		onNavigate: () => {},
		onPageChange: () => {},
		onSelect: () => {},
		onClose: () => {},
		...overrides,
	};
}

test("directory picker wires parent, row, select, and hidden-directory controls", () => {
	const navigated: string[] = [];
	const selected: string[] = [];
	const hidden: boolean[] = [];
	const tree = DirectoryPickerContents(
		props({
			onNavigate: (path) => {
				if (path) navigated.push(path);
			},
			onSelect: (path) => selected.push(path),
			onIncludeHiddenChange: (value) => hidden.push(value),
		}),
	);
	const all = elements(tree);
	const parent = all.find((element) => element.props["aria-label"] === "Go to parent directory");
	const row = all.find(
		(element) => element.type === "button" && text(element.props.children) === "child",
	);
	const select = all.find((element) => text(element.props.children) === "Select this directory");
	const checkbox = all.find(
		(element) => element.type === "input" && element.props.type === "checkbox",
	);
	if (!parent || !row || !select || !checkbox) throw new Error("picker control missing");

	(parent.props.onClick as () => void)();
	(row.props.onClick as () => void)();
	(select.props.onClick as () => void)();
	(checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({
		target: { checked: true },
	});

	expect(navigated).toEqual(["/mount", "/mount/work/child"]);
	expect(selected).toEqual(["/mount/work"]);
	expect(hidden).toEqual([true]);
	expect(parentPath("/mount/work")).toBe("/mount");
});

test("directory picker presents a request error instead of stale directory rows", () => {
	const markup = renderToStaticMarkup(
		<DirectoryPickerContents {...props({ error: "Couldn't load directories." })} />,
	);
	expect(markup).toContain('role="alert"');
	expect(markup).toContain("Couldn&#x27;t load directories.");
	expect(markup).not.toContain(">child<");
});
