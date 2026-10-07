import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { RowPalette } from "./tool-row.ts";

type ChangeKind = "added" | "removed" | "context";

type Entry = {
	readonly kind: ChangeKind;
	readonly text: string;
	readonly number: number;
};

type DiffLine =
	| Entry
	| {
			readonly kind: "omission";
			readonly hidden: number;
			readonly reason: "context" | "budget";
	  };

export type EditDiff = {
	readonly lines: readonly DiffLine[];
	readonly added: number;
	readonly removed: number;
	readonly hunks: number;
	readonly clipped: boolean;
};

type Cursor = {
	readonly old: number;
	readonly new: number;
};

type ParsedPatch = {
	readonly entries: readonly Entry[];
	readonly hunks: number;
};

const CONTEXT = 1;
const MAX_DIFF_LINES = 8;
const HUNK = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)/;
const ELLIPSIS = "…";
const INDENT = "  ";

function changeKind(marker: string | undefined): ChangeKind | undefined {
	switch (marker) {
		case "+":
			return "added";
		case "-":
			return "removed";
		case " ":
			return "context";
		default:
			return undefined;
	}
}

function parsePatch(patch: string): ParsedPatch {
	const entries: Entry[] = [];
	let hunks = 0;
	let cursor: Cursor | undefined;

	for (const raw of patch.split("\n")) {
		const hunk = HUNK.exec(raw);
		if (hunk !== null) {
			hunks += 1;
			cursor = { old: Number(hunk[1]), new: Number(hunk[2]) };
			continue;
		}
		const kind = changeKind(raw[0]);
		if (cursor === undefined || kind === undefined) continue;

		const text = raw.slice(1);
		if (kind === "removed") {
			entries.push({ kind, text, number: cursor.old });
			cursor = { old: cursor.old + 1, new: cursor.new };
		} else if (kind === "added") {
			entries.push({ kind, text, number: cursor.new });
			cursor = { old: cursor.old, new: cursor.new + 1 };
		} else {
			entries.push({ kind, text, number: cursor.new });
			cursor = { old: cursor.old + 1, new: cursor.new + 1 };
		}
	}

	return { entries, hunks };
}

function nearChange(entries: readonly Entry[], index: number): boolean {
	const from = Math.max(0, index - CONTEXT);
	return entries.slice(from, index + CONTEXT + 1).some((entry) => entry.kind !== "context");
}

function hiddenBefore(shown: readonly boolean[], index: number): number {
	return index === 0 ? 0 : index - 1 - shown.lastIndexOf(true, index - 1);
}

function withContext(entries: readonly Entry[]): readonly DiffLine[] {
	const shown = entries.map((_entry, index) => nearChange(entries, index));
	return entries.flatMap((entry, index): DiffLine[] => {
		if (shown[index] !== true) return [];
		const hidden = hiddenBefore(shown, index);
		return hidden > 0 ? [{ kind: "omission", hidden, reason: "context" }, entry] : [entry];
	});
}

function withinBudget(lines: readonly DiffLine[]): readonly DiffLine[] {
	const visible = MAX_DIFF_LINES - 1;
	const leading = Math.ceil(visible / 2);
	const trailing = Math.floor(visible / 2);
	const omitted = lines.slice(leading, lines.length - trailing);
	const hidden = omitted.reduce((total, line) => total + (line.kind === "omission" ? line.hidden : 1), 0);
	return [
		...lines.slice(0, leading),
		{ kind: "omission", hidden, reason: "budget" },
		...lines.slice(lines.length - trailing),
	];
}

export function editDiff(patch: string): EditDiff {
	const { entries, hunks } = parsePatch(patch);
	const lines = withContext(entries);
	const clipped = lines.length > MAX_DIFF_LINES;
	return {
		lines: clipped ? withinBudget(lines) : lines,
		added: entries.filter((entry) => entry.kind === "added").length,
		removed: entries.filter((entry) => entry.kind === "removed").length,
		hunks,
		clipped,
	};
}

export function editSummary(diff: EditDiff): string | undefined {
	if (diff.added === 0 && diff.removed === 0) return undefined;
	const change = `+${diff.added} −${diff.removed}`;
	return diff.clipped && diff.hunks > 1 ? `${change} · ${diff.hunks} hunks` : change;
}

function markerOf(line: DiffLine): string {
	switch (line.kind) {
		case "added":
			return "+";
		case "removed":
			return "-";
		case "omission":
			return ELLIPSIS;
		case "context":
			return " ";
	}
}

function colorOf(line: DiffLine): "toolDiffAdded" | "toolDiffRemoved" | "toolDiffContext" {
	if (line.kind === "added") return "toolDiffAdded";
	if (line.kind === "removed") return "toolDiffRemoved";
	return "toolDiffContext";
}

function lineText(line: DiffLine, room: number): string {
	if (line.kind !== "omission") return truncateToWidth(line.text, room, ELLIPSIS);
	return line.reason === "context" ? `${line.hidden} unchanged` : `${line.hidden} more lines`;
}

export function renderDiff(lines: readonly DiffLine[], width: number, palette: RowPalette): string[] {
	const gutter = Math.max(1, ...lines.map((line) => (line.kind === "omission" ? 1 : String(line.number).length)));
	return lines.flatMap((line) => {
		const number = line.kind === "omission" ? "" : String(line.number);
		const prefix = INDENT + (markerOf(line) + number).padStart(gutter + 1, " ") + " ";
		const room = width - visibleWidth(prefix);
		return room <= 0 ? [] : [palette.fg(colorOf(line), prefix + lineText(line, room))];
	});
}
