import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { RowPalette } from "./tool-row.ts";

/** One line of a compact diff. */
export type DiffLine =
	| {
			readonly kind: "added" | "removed" | "context";
			/** The line's text, as it appears in the file. */
			readonly text: string;
			/** Line number in the file after the edit. */
			readonly number: number;
	  }
	| {
			readonly kind: "omission";
			/** How many source lines the diff is not showing here. */
			readonly hidden: number;
			/** Whether the omission removes only context or enforces the collapsed-view budget. */
			readonly reason: "context" | "budget";
	  };

/** Lines of unchanged context kept on each side of a change. */
const CONTEXT = 1;

/** Most lines a collapsed diff will show before it defers to the expanded view. */
export const MAX_DIFF_LINES = 8;

const HUNK = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)/;
const ELLIPSIS = "…";
const INDENT = "  ";

type Entry = {
	readonly kind: "added" | "removed" | "context";
	readonly text: string;
	readonly number: number;
};

function parsePatch(patch: string): Entry[] {
	const entries: Entry[] = [];
	let line = 0;

	for (const raw of patch.split("\n")) {
		const hunk = HUNK.exec(raw);
		if (hunk?.[1] !== undefined) {
			line = Number.parseInt(hunk[1], 10);
			continue;
		}
		// File headers and the no-newline marker are not part of the change.
		if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("\\")) continue;
		if (line === 0) continue;

		const body = raw.slice(1);
		if (raw.startsWith("+")) {
			entries.push({ kind: "added", text: body, number: line });
			line += 1;
		} else if (raw.startsWith("-")) {
			// A removed line is numbered where it used to sit, so the pair reads together.
			entries.push({ kind: "removed", text: body, number: line });
		} else if (raw.startsWith(" ")) {
			entries.push({ kind: "context", text: body, number: line });
			line += 1;
		}
	}

	return entries;
}

/**
 * Reduce a unified patch to the lines worth reading.
 *
 * Every changed line is kept, with one line of context on each side of a change
 * group. Context the patch carried but the eye does not need becomes a single
 * omission marker, so two changes far apart in a file stay two change groups
 * rather than one wall of unchanged code.
 *
 * @param patch - A standard unified patch.
 * @returns The lines to render, in file order.
 */
export function compactDiff(patch: string): DiffLine[] {
	const entries = parsePatch(patch);
	const keep = entries.map((entry) => entry.kind !== "context");
	entries.forEach((entry, index) => {
		if (entry.kind === "context") return;
		for (let offset = 1; offset <= CONTEXT; offset += 1) {
			if (index - offset >= 0) keep[index - offset] = true;
			if (index + offset < entries.length) keep[index + offset] = true;
		}
	});

	const lines: DiffLine[] = [];
	let hidden = 0;
	for (const [index, entry] of entries.entries()) {
		if (keep[index] !== true) {
			hidden += 1;
			continue;
		}
		if (hidden > 0) {
			lines.push({ kind: "omission", hidden, reason: "context" });
			hidden = 0;
		}
		lines.push(entry);
	}

	if (lines.length <= MAX_DIFF_LINES) return lines;

	// Keep both ends: the opening identifies the change and the tail shows where
	// it landed. The expanded renderer remains the complete source of truth.
	const visibleLines = MAX_DIFF_LINES - 1;
	const leadingCount = Math.ceil(visibleLines / 2);
	const trailingCount = Math.floor(visibleLines / 2);
	const leading = lines.slice(0, leadingCount);
	const trailing = lines.slice(lines.length - trailingCount);
	const omitted = lines.slice(leadingCount, lines.length - trailingCount);
	const budgetHidden = omitted.reduce((total, line) => total + (line.kind === "omission" ? line.hidden : 1), 0);
	return [...leading, { kind: "omission", hidden: budgetHidden, reason: "budget" }, ...trailing];
}

function markerOf(line: DiffLine): string {
	if (line.kind === "added") return "+";
	if (line.kind === "removed") return "-";
	if (line.kind === "omission") return ELLIPSIS;
	return " ";
}

function colorOf(line: DiffLine): "toolDiffAdded" | "toolDiffRemoved" | "toolDiffContext" {
	if (line.kind === "added") return "toolDiffAdded";
	if (line.kind === "removed") return "toolDiffRemoved";
	return "toolDiffContext";
}

/**
 * Render a compact diff under a collapsed edit row.
 *
 * The gutter is as wide as the largest line number, so the code column starts in
 * the same place on every line. A line too long for the terminal is truncated
 * rather than wrapped, because a wrapped diff stops looking like one.
 *
 * @param lines - The lines from `compactDiff`.
 * @param width - Visible terminal width.
 * @param palette - Theme slice used to color the diff.
 * @returns One string per line, none wider than `width`.
 */
export function renderDiff(lines: readonly DiffLine[], width: number, palette: RowPalette): string[] {
	if (lines.length === 0) return [];

	let gutter = 1;
	for (const line of lines) {
		if (line.kind !== "omission") gutter = Math.max(gutter, String(line.number).length);
	}

	const rendered: string[] = [];
	for (const line of lines) {
		// The marker and the number are aligned as one token, so the digits line up
		// however wide the numbers get and the marker leans in from the left.
		const number = line.kind === "omission" ? "" : String(line.number);
		const prefix = INDENT + (markerOf(line) + number).padStart(gutter + 1, " ") + " ";
		const room = width - visibleWidth(prefix);
		if (room <= 0) continue;

		const text =
			line.kind === "omission"
				? line.reason === "context"
					? `${line.hidden} unchanged`
					: `${line.hidden} more lines`
				: truncateToWidth(line.text, room, ELLIPSIS);
		rendered.push(palette.fg(colorOf(line), prefix + text));
	}
	return rendered;
}
