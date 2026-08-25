import type { FileNode } from "@mewa-code/contracts";
import { useRef, useState } from "react";
import { type TabIntent, useAppStore } from "../store";
import { getTransport } from "../transport";
import { type ResolvedFolderChain, resolveFolderChain } from "./folder-chains";
import { openFileInTab } from "./open-tabs";
import { TreeRow } from "./tree-row";
import { useProjectRead } from "./use-project-read";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;

export function FileTree({ projectAreaId }: { projectAreaId: string }) {
	const roots = useAppStore(
		(state) => state.projects.find((project) => project.id === projectAreaId)?.roots ?? [],
	);
	if (roots.length === 0)
		return <p className="px-xs py-xs tr-text-metadata text-text-muted">No roots</p>;
	return (
		<div className="flex flex-col">
			{roots.map((root) => (
				<section key={root}>
					{roots.length > 1 ? (
						<div className="truncate px-xs py-xs tr-text-eyebrow text-text-muted" title={root}>
							{root.split("/").pop() || root}
						</div>
					) : null}
					<RootTree projectAreaId={projectAreaId} root={root} />
				</section>
			))}
		</div>
	);
}

function RootTree({ projectAreaId, root }: { projectAreaId: string; root: string }) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(() => new Set());

	const setPathsExpanded: SetPathsExpanded = (paths, expanded) => {
		setExpandedPaths((current) => {
			const next = new Set(current);
			for (const path of paths) {
				if (expanded) next.add(path);
				else next.delete(path);
			}
			return next;
		});
	};

	useProjectRead(
		projectAreaId,
		(id) => getTransport().request("fs.readDir", { projectId: id, root, path: "." }),
		{
			onResult: (result) => setNodes(result),
			onFailure: () => setNodes((prev) => prev ?? []),
			onSwitch: () => setNodes(null),
		},
	);

	if (nodes === null)
		return <p className="px-xs py-xs tr-text-metadata text-text-muted">Loading…</p>;
	if (nodes.length === 0)
		return <p className="px-xs py-xs tr-text-metadata text-text-muted">Empty</p>;
	return (
		<ul className="flex flex-col">
			{nodes.map((node) => (
				<FileNodeRow
					key={node.path}
					node={node}
					projectAreaId={projectAreaId}
					root={root}
					expandedPaths={expandedPaths}
					setPathsExpanded={setPathsExpanded}
				/>
			))}
		</ul>
	);
}

function FileNodeRow({
	node,
	projectAreaId,
	root,
	expandedPaths,
	setPathsExpanded,
}: {
	node: FileNode;
	projectAreaId: string;
	root: string;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
}) {
	const isDir = node.kind === "dir";
	const [directory, setDirectory] = useState<ResolvedFolderChain<FileNode> | null>(null);
	const pendingExpand = useRef(false);

	const { reload } = useProjectRead(
		isDir ? projectAreaId : null,
		(id) =>
			resolveFolderChain(node, (path) =>
				getTransport().request("fs.readDir", { projectId: id, root, path }),
			),
		{
			onResult: (result) => {
				setDirectory(result);
				if (!pendingExpand.current) return;
				pendingExpand.current = false;
				setPathsExpanded(result.paths, true);
			},
			onSwitch: () => {
				pendingExpand.current = false;
				setDirectory(null);
			},
		},
	);

	const label = directory?.label ?? node.name;
	const representedPaths = directory?.paths ?? [node.path];
	const expanded = expandedPaths.has(directory?.path ?? node.path);
	const children = directory?.children ?? null;
	const toggleDirectory = () => {
		const nextExpanded = !expanded;
		pendingExpand.current = nextExpanded && directory === null;
		setPathsExpanded(representedPaths, nextExpanded);
		if (nextExpanded) reload();
	};
	const open = (intent: TabIntent) =>
		void openFileInTab(projectAreaId, node.path, intent, undefined, root);

	return (
		<li>
			<TreeRow
				testid="file-node"
				kind={isDir ? "dir" : "file"}
				expanded={expanded}
				label={label}
				onClick={isDir ? toggleDirectory : () => open("preview")}
				onDoubleClick={isDir ? undefined : () => open("keep")}
			/>
			{isDir && expanded && children && (
				<ul className="flex flex-col pl-md">
					{children.map((child) => (
						<FileNodeRow
							key={child.path}
							node={child}
							projectAreaId={projectAreaId}
							root={root}
							expandedPaths={expandedPaths}
							setPathsExpanded={setPathsExpanded}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
