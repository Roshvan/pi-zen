import { stripTerminalSequences } from "@earendil-works/pi-tui";

const RAIL_GLYPH = "┃";

export const MIN_RAIL_PADDING = 2;

type RailPaint = (glyph: string) => string;

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
