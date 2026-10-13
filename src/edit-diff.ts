import { stripVTControlCharacters } from "node:util";

import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, sliceByColumn, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { liveTheme, renderPalette } from "./backgroundless-theme.ts";
import type { RowPalette } from "./tool-row.ts";
import { widthCached } from "./width-cache.ts";

type ChangeKind = "added" | "removed" | "context";

type Entry = {
	readonly kind: ChangeKind;
	readonly text: string;
	readonly number: number;
};

type Hunk = {
	readonly kind: "hunk";
	readonly text: string;
};

type DiffLine = Entry | Hunk;

export type EditDiff = {
	readonly lines: readonly DiffLine[];
	readonly sections: readonly (readonly Entry[])[];
	readonly added: number;
	readonly removed: number;
	readonly hunks: number;
};

type Cursor = {
	readonly old: number;
	readonly new: number;
};

const HUNK = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;
const ELLIPSIS = "…";
const INDENT = "  ";
const TAB = "   ";

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

function lineRange(start: number, count: number): string {
	if (count === 0) return `after ${start}`;
	return count === 1 ? String(start) : `${start}–${start + count - 1}`;
}

export function editDiff(patch: string): EditDiff {
	const lines: DiffLine[] = [];
	const sections: Entry[][] = [];
	let section: Entry[] | undefined;
	let added = 0;
	let removed = 0;
	let cursor: Cursor | undefined;

	for (const raw of stripVTControlCharacters(patch).replaceAll("\r", "").split("\n")) {
		const hunk = HUNK.exec(raw);
		if (hunk !== null) {
			section = [];
			sections.push(section);
			cursor = { old: Number(hunk[1]), new: Number(hunk[3]) };
			const before = lineRange(cursor.old, Number(hunk[2] ?? 1));
			const after = lineRange(cursor.new, Number(hunk[4] ?? 1));
			lines.push({ kind: "hunk", text: `lines ${before} → ${after}` });
			continue;
		}
		const kind = changeKind(raw[0]);
		if (cursor === undefined || section === undefined || kind === undefined) continue;

		const entry: Entry = {
			kind,
			text: raw.slice(1).replaceAll("\t", TAB),
			number: kind === "removed" ? cursor.old : cursor.new,
		};
		section.push(entry);
		lines.push(entry);
		if (kind === "added") added += 1;
		if (kind === "removed") removed += 1;
		cursor = {
			old: cursor.old + (kind === "added" ? 0 : 1),
			new: cursor.new + (kind === "removed" ? 0 : 1),
		};
	}

	return { lines, sections, added, removed, hunks: sections.length };
}

export function editSummary(diff: EditDiff): string | undefined {
	if (diff.added === 0 && diff.removed === 0) return undefined;
	const change = `+${diff.added} −${diff.removed}`;
	return diff.hunks > 1 ? `${change} · ${diff.hunks} hunks` : change;
}

function markerOf(line: Entry): string {
	if (line.kind === "added") return "+";
	if (line.kind === "removed") return "−";
	return " ";
}

function colorOf(line: Entry): "toolDiffAdded" | "toolDiffRemoved" | "toolDiffContext" {
	if (line.kind === "added") return "toolDiffAdded";
	if (line.kind === "removed") return "toolDiffRemoved";
	return "toolDiffContext";
}

function highlightDiff(diff: EditDiff, path: string | undefined): ReadonlyMap<Entry, string> {
	const language = path === undefined ? undefined : getLanguageFromPath(path);
	const colors = new Map<Entry, string>();
	for (const entries of diff.sections) {
		// Highlight each side together so multiline syntax survives added/removed lines.
		for (const excluded of ["added", "removed"] as const) {
			const side = entries.filter((entry) => entry.kind !== excluded);
			const colored = highlightCode(side.map((entry) => entry.text).join("\n"), language);
			for (const [index, entry] of side.entries()) colors.set(entry, colored[index] ?? entry.text);
		}
	}
	return colors;
}

function codeChunks(code: string, room: number): string[] {
	const indent = /^ */.exec(stripVTControlCharacters(code))?.[0] ?? "";
	const width = visibleWidth(code);
	const hangs = width > room && indent.length > 0 && indent.length * 2 <= room;
	const body = hangs ? sliceByColumn(code, indent.length, width - indent.length) : code;
	const bodyRoom = hangs ? room - indent.length : room;
	return wrapTextWithAnsi(body, bodyRoom).map((chunk) => (hangs ? indent : "") + chunk);
}

function renderDiff(
	lines: readonly DiffLine[],
	width: number,
	palette: RowPalette,
	colors: ReadonlyMap<Entry, string>,
): string[] {
	const gutter = lines.reduce(
		(width, line) => line.kind === "hunk" ? width : Math.max(width, String(line.number).length),
		1,
	);
	return lines.flatMap((line) => {
		if (line.kind === "hunk") {
			return width <= INDENT.length
				? []
				: [palette.fg("toolDiffContext", INDENT + truncateToWidth(line.text, width - INDENT.length, ELLIPSIS))];
		}
		const prefix = INDENT + (markerOf(line) + String(line.number)).padStart(gutter + 1, " ") + " ";
		const room = width - visibleWidth(prefix);
		if (room <= 0) return [];
		const chunks = codeChunks(colors.get(line) ?? line.text, room);
		const continued = " ".repeat(visibleWidth(prefix));
		return chunks.map((chunk, index) => (index === 0 ? palette.fg(colorOf(line), prefix) : continued) + chunk);
	});
}

export function diffLayout(diff: EditDiff, path: string | undefined, theme: Theme): Component {
	let colored: { readonly palette: string; readonly colors: ReadonlyMap<Entry, string> } | undefined;
	return widthCached((width) => {
		const palette = renderPalette(liveTheme() ?? theme);
		if (colored === undefined || colored.palette !== palette) colored = { palette, colors: highlightDiff(diff, path) };
		return renderDiff(diff.lines, width, theme, colored.colors);
	}, []);
}
