import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** Glyph drawn in the editor's left padding in place of Pi's horizontal frame. */
export const RAIL_GLYPH = "┃";

/**
 * Smallest editor padding the rail can occupy: one column for the glyph and one
 * for the gap before the text. Pi's editor keeps its own layout maths, so the
 * rail only ever overwrites padding columns that are already blank.
 */
export const MIN_RAIL_PADDING = 2;

/** Paints the rail glyph, normally with the editor's current border color. */
export type RailPaint = (glyph: string) => string;

function isFrameRow(row: string): boolean {
	return stripTerminalSequences(row).startsWith("─");
}

function carriesScrollHint(row: string): boolean {
	const plain = stripTerminalSequences(row);
	return plain.includes("↑") || plain.includes("↓");
}

function railBodyRow(row: string, paddingX: number, paint: RailPaint): string {
	const indent = " ".repeat(paddingX);
	if (!row.startsWith(indent)) return row;
	return paint(RAIL_GLYPH) + " ".repeat(paddingX - 1) + row.slice(paddingX);
}

/**
 * Rewrite the rows Pi's editor rendered into the Zen presentation: the two
 * horizontal frame rows disappear and the input gains a single left rail.
 *
 * Frame rows that carry a scroll hint (`─── ↑ 3 more ───`) are kept, because
 * they report content the editor is hiding. Body rows keep their exact visible
 * width, so cursor geometry, the hardware cursor marker, selection, and
 * wrapping stay identical to the base editor. Rows below the bottom frame
 * (the autocomplete list) pass through untouched.
 *
 * @param rows - Rows returned by the base editor's `render`.
 * @param paddingX - The editor's current horizontal padding.
 * @param paint - Styles the rail glyph.
 * @returns The rows to render. Returned unchanged when the padding is too small
 * for a rail or when the rows do not look like Pi's framed editor.
 */
export function applyRail(rows: readonly string[], paddingX: number, paint: RailPaint): string[] {
	if (paddingX < MIN_RAIL_PADDING || rows.length < 2) return [...rows];

	const frames: number[] = [];
	for (const [index, row] of rows.entries()) {
		if (isFrameRow(row)) frames.push(index);
	}

	const top = frames.at(0);
	const bottom = frames.at(-1);
	if (top !== 0 || bottom === undefined || bottom <= top) return [...rows];

	const railed: string[] = [];
	for (const [index, row] of rows.entries()) {
		if (index === top || index === bottom) {
			if (carriesScrollHint(row)) railed.push(row);
			continue;
		}
		railed.push(index > bottom ? row : railBodyRow(row, paddingX, paint));
	}
	return railed;
}
