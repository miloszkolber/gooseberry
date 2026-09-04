const foldState = new Map<string, boolean>();

export function readFold(id: string, fallback = false): boolean {
	return foldState.get(id) ?? fallback;
}

export function writeFold(id: string, expanded: boolean): boolean {
	foldState.set(id, expanded);
	return expanded;
}

export function toggleFold(id: string, current: boolean): boolean {
	return writeFold(id, !current);
}

const selectionState = new Map<string, string | null>();

export function readSelection(id: string): string | null {
	return selectionState.get(id) ?? null;
}

export function selectValue(id: string, current: string | null, key: string): string | null {
	const next = current === key ? null : key;
	selectionState.set(id, next);
	return next;
}
