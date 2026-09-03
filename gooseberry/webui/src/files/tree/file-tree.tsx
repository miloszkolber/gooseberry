import type { FileNode } from "@gooseberry/contracts";
import { useRef, useState } from "react";
import { getTransport } from "../../connection";
import { type TabIntent, useAppStore } from "../../store";
import { useProjectRead } from "../../workspace/projects/use-project-read";
import { openFileInTab } from "../tabs/open-tabs";
import { type ResolvedFolderChain, resolveFolderChain } from "./folder-chains";
import { TreeRow } from "./tree-row";

type SetPathsExpanded = (paths: readonly string[], expanded: boolean) => void;

export function FileTree({
	projectAreaId,
	onOpen,
}: {
	projectAreaId: string;
	onOpen?: () => void;
}) {
	const root = useAppStore(
		(state) => state.projects.find((project) => project.id === projectAreaId)?.roots[0] ?? "",
	);
	if (!root) return <p className="px-xs py-xs tr-text-metadata text-text-muted">No root</p>;
	return (
		<div className="flex flex-col">
			<RootTree projectAreaId={projectAreaId} root={root} onOpen={onOpen} />
		</div>
	);
}

function RootTree({
	projectAreaId,
	root,
	onOpen,
}: {
	projectAreaId: string;
	root: string;
	onOpen: (() => void) | undefined;
}) {
	const [nodes, setNodes] = useState<FileNode[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [warnings, setWarnings] = useState<string[]>([]);
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

	const { reload } = useProjectRead(
		projectAreaId,
		(id) => getTransport().request("fs.readDir", { projectId: id, path: "." }),
		{
			onResult: (result) => {
				setNodes(result.nodes);
				setWarnings(result.warnings);
				setError(null);
			},
			onFailure: (_id, failure) => {
				setNodes(null);
				setError(failure instanceof Error ? failure.message : "File tree is unavailable.");
			},
			onSwitch: () => {
				setNodes(null);
				setError(null);
				setWarnings([]);
			},
		},
	);

	if (error)
		return (
			<div className="flex flex-col items-start gap-xs px-xs py-xs">
				<p role="alert" className="tr-text-metadata text-feedback-error">
					File tree unavailable.
				</p>
				<button
					type="button"
					onClick={reload}
					className="min-h-7 rounded-[var(--radius-sm)] px-xs tr-text-metadata text-text-muted hover:bg-control-bg-hovered"
				>
					Retry
				</button>
			</div>
		);
	if (nodes === null)
		return (
			<p role="status" className="px-xs py-xs tr-text-metadata text-text-muted">
				Loading files…
			</p>
		);
	if (nodes.length === 0)
		return <p className="px-xs py-xs tr-text-metadata text-text-muted">Empty</p>;
	return (
		<>
			{warnings.length > 0 ? (
				<p role="status" className="px-xs py-xs tr-text-metadata text-feedback-warning">
					{warnings.join(" ")}
				</p>
			) : null}
			<ul className="flex flex-col">
				{nodes.map((node) => (
					<FileNodeRow
						key={node.path}
						node={node}
						projectAreaId={projectAreaId}
						root={root}
						expandedPaths={expandedPaths}
						setPathsExpanded={setPathsExpanded}
						onOpen={onOpen}
					/>
				))}
			</ul>
		</>
	);
}

function FileNodeRow({
	node,
	projectAreaId,
	root,
	expandedPaths,
	setPathsExpanded,
	onOpen,
}: {
	node: FileNode;
	projectAreaId: string;
	root: string;
	expandedPaths: ReadonlySet<string>;
	setPathsExpanded: SetPathsExpanded;
	onOpen: (() => void) | undefined;
}) {
	const isDir = node.kind === "dir";
	const [directory, setDirectory] = useState<ResolvedFolderChain<FileNode> | null>(null);
	const pendingExpand = useRef(false);

	const { reload } = useProjectRead(
		isDir ? projectAreaId : null,
		(id) =>
			resolveFolderChain(node, (path) =>
				getTransport()
					.request("fs.readDir", { projectId: id, path })
					.then((listing) => listing.nodes),
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
		void openFileInTab(projectAreaId, node.path, intent).then((opened) => {
			if (opened) onOpen?.();
		});

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
							onOpen={onOpen}
						/>
					))}
				</ul>
			)}
		</li>
	);
}
