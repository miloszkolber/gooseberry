import type { DirectoryListing } from "@gooseberry/contracts";
import { ChevronLeft, Eye, EyeOff, Folder, FolderOpen, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { errorText, getTransport } from "@/transport";

const PAGE_SIZE = 100;

export function parentPath(path: string): string | null {
	const end = path.length > 1 && path.endsWith("/") ? path.length - 1 : path.length;
	const index = path.lastIndexOf("/", end - 1);
	return index > 0 ? path.slice(0, index) : null;
}

export interface DirectoryPickerContentsProps {
	listing: DirectoryListing | null;
	loading: boolean;
	error: string | null;
	includeHidden: boolean;
	onIncludeHiddenChange: (includeHidden: boolean) => void;
	onNavigate: (path: string | undefined) => void;
	onPageChange: (page: (current: number) => number) => void;
	onSelect: (path: string) => void;
	onClose: () => void;
}

export function DirectoryPickerContents({
	listing,
	loading,
	error,
	includeHidden,
	onIncludeHiddenChange,
	onNavigate,
	onPageChange,
	onSelect,
	onClose,
}: DirectoryPickerContentsProps) {
	const current = listing?.path ?? null;
	const atRoot = current !== null && listing?.roots.includes(current) === true;
	const parent = current && !atRoot ? parentPath(current) : null;
	const canSelect = current !== null && !loading && error === null;

	return (
		<>
			<div className="flex min-w-0 items-center gap-xs rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-sm py-xs">
				<Button
					variant="ghost"
					size="icon"
					aria-label="Go to parent directory"
					disabled={!parent || loading}
					onClick={() => parent && onNavigate(parent)}
				>
					<ChevronLeft className="size-4" />
				</Button>
				<span
					data-testid="directory-picker-path"
					className="min-w-0 flex-1 truncate tr-text-metadata text-text-default"
				>
					{current ?? "Configured directories"}
				</span>
			</div>
			<label className="flex items-center gap-xs self-start tr-text-metadata text-text-muted">
				<input
					type="checkbox"
					checked={includeHidden}
					disabled={loading}
					onChange={(event) => onIncludeHiddenChange(event.target.checked)}
				/>
				{includeHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
				Show hidden directories
			</label>
			<div
				className="min-h-40 overflow-auto rounded-[var(--radius-sm)] border border-border-default"
				aria-busy={loading}
			>
				{loading ? (
					<div
						role="status"
						className="flex min-h-40 items-center justify-center gap-sm tr-text-ui text-text-muted"
					>
						<LoaderCircle className="size-4 animate-spin" /> Loading directories…
					</div>
				) : error ? (
					<div
						role="alert"
						className="flex min-h-40 items-center justify-center px-md text-center tr-text-ui text-feedback-error"
					>
						{error}
					</div>
				) : listing?.directories.length ? (
					<ul aria-label="Directories" className="p-2xs">
						{listing.directories.map((directory) => (
							<li key={directory.path}>
								<button
									type="button"
									onClick={() => onNavigate(directory.path)}
									className="flex w-full items-center gap-sm rounded-[var(--radius-sm)] px-sm py-xs text-left outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
								>
									{current === null ? (
										<Folder className="size-4 shrink-0 text-primary" />
									) : (
										<FolderOpen className="size-4 shrink-0 text-primary" />
									)}
									<span className="min-w-0 flex-1 truncate tr-text-ui">{directory.name}</span>
								</button>
							</li>
						))}
					</ul>
				) : (
					<p className="flex min-h-40 items-center justify-center px-md text-center tr-text-ui text-text-muted">
						No directories are available here.
					</p>
				)}
			</div>
			{listing && (listing.page > 0 || listing.hasMore) ? (
				<div className="flex items-center justify-between gap-sm">
					<Button
						variant="ghost"
						size="sm"
						disabled={listing.page === 0 || loading}
						onClick={() => onPageChange((value) => value - 1)}
					>
						Previous
					</Button>
					<span className="tr-text-metadata text-text-muted">Page {listing.page + 1}</span>
					<Button
						variant="ghost"
						size="sm"
						disabled={!listing.hasMore || loading}
						onClick={() => onPageChange((value) => value + 1)}
					>
						Next
					</Button>
				</div>
			) : null}
			<DialogFooter>
				<Button variant="ghost" onClick={onClose}>
					Cancel
				</Button>
				<Button disabled={!canSelect} onClick={() => current && onSelect(current)}>
					Select this directory
				</Button>
			</DialogFooter>
		</>
	);
}

export function DirectoryPickerDialog({
	open,
	onOpenChange,
	onSelect,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (path: string) => void;
}) {
	const [path, setPath] = useState<string | undefined>();
	const [page, setPage] = useState(0);
	const [includeHidden, setIncludeHidden] = useState(false);
	const [listing, setListing] = useState<DirectoryListing | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const requestId = useRef(0);

	const load = useCallback(async () => {
		if (!open) return;
		const id = ++requestId.current;
		setLoading(true);
		setError(null);
		try {
			const result = await getTransport().request("directory.list", {
				...(path ? { path } : {}),
				page,
				pageSize: PAGE_SIZE,
				includeHidden,
			});
			if (id === requestId.current) setListing(result);
		} catch (cause) {
			if (id === requestId.current) setError(errorText(cause, "Couldn't load directories."));
		} finally {
			if (id === requestId.current) setLoading(false);
		}
	}, [includeHidden, open, page, path]);

	useEffect(() => {
		if (!open) return;
		setPath(undefined);
		setPage(0);
		setIncludeHidden(false);
		setListing(null);
		setError(null);
	}, [open]);

	useEffect(() => {
		void load();
	}, [load]);

	const navigate = (next: string | undefined) => {
		setPath(next);
		setPage(0);
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[min(38rem,calc(100vh-2rem))] max-w-[min(42rem,calc(100vw-2rem))] gap-md overflow-hidden">
				<DialogHeader>
					<DialogTitle>Choose a project directory</DialogTitle>
					<DialogDescription>
						Only directories under configured Gooseberry mounts are available.
					</DialogDescription>
				</DialogHeader>
				<DirectoryPickerContents
					listing={listing}
					loading={loading}
					error={error}
					includeHidden={includeHidden}
					onIncludeHiddenChange={(next) => {
						setIncludeHidden(next);
						setPage(0);
					}}
					onNavigate={navigate}
					onPageChange={setPage}
					onSelect={onSelect}
					onClose={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}
