import { type MarkdownTheme, Markdown, visibleWidth } from "@earendil-works/pi-tui";
import { stripVTControlCharacters } from "node:util";

type Part = { readonly text: string; readonly start: number; readonly end: number };

type Piece = Part & { readonly width: number; readonly joint: "space" | "flush" };

type Row = { readonly start: number; readonly end: number; readonly width: number; readonly gaps: number };

type CodeSpan = { readonly fence: string; readonly from: number; readonly to: number };

type Measure = (text: string) => number;

type Balance = { readonly ticks: number; readonly stars: number; readonly depth: number };

type BalanceKey = (balance: Balance) => string;

const INLINE_SYNTAX = /[$*\\_`~[<&\t]|www\./i;
const WORD = /(?<=^| )[^ ]*/g;
const BALANCE_MARKERS = /[`*[\]]/;
const BACKTICK_RUN = /`+/g;
const LINK_TARGET = "](";
const UNMARKED: Balance = { ticks: 0, stars: 0, depth: 0 };
const PROBE_LEAD = "\u00A0";
const PROBE_COLUMNS = 4096;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const plain: MarkdownTheme = {
	heading: identity,
	link: identity,
	linkUrl: identity,
	code: identity,
	codeBlock: identity,
	codeBlockBorder: identity,
	quote: identity,
	quoteBorder: identity,
	hr: identity,
	listBullet: identity,
	bold: identity,
	italic: identity,
	strikethrough: identity,
	underline: identity,
};

function identity(text: string): string {
	return text;
}

export function wrapInlineMarkdown(line: string, room: number): readonly string[] {
	const measure = rememberedWidths();
	if (measure(line) <= room) return [line];

	const pieces = grouped(line, 0, inlineBalance).flatMap((atom) => fitted(atom, room, measure));
	return closedAcrossRows(line, packed(pieces, room));
}

function rememberedWidths(): Measure {
	const widths = new Map<string, number>();
	return (text) => {
		const known = widths.get(text);
		if (known !== undefined) return known;
		const width = drawnWidth(text);
		widths.set(text, width);
		return width;
	};
}

function drawnWidth(text: string): number {
	if (!INLINE_SYNTAX.test(text)) return visibleWidth(text.trimEnd());
	const markdown = new Markdown(`${PROBE_LEAD}${text}`, 0, 0, plain, undefined, {
		renderLatex: false,
		preserveBackslashEscapes: true,
	});
	const drawn = stripVTControlCharacters(markdown.render(PROBE_COLUMNS)[0] ?? "").trimEnd();
	return Math.max(0, visibleWidth(drawn) - 1);
}

function partsOf(text: string, offset: number): readonly Part[] {
	return Array.from(text.matchAll(WORD), (match) => ({
		text: match[0],
		start: offset + match.index,
		end: offset + match.index + match[0].length,
	}));
}

function inlineBalance(balance: Balance): string {
	return `${balance.ticks % 2}:${balance.stars % 2}:${balance.depth}`;
}

function linkBalance(balance: Balance): string {
	return `${balance.depth}`;
}

function grouped(text: string, offset: number, keyOf: BalanceKey): readonly Part[] {
	const words = partsOf(text, offset);
	const keys = balances(words).map(keyOf);
	const bounds: { readonly start: number; readonly end: number }[] = [];
	let closesAt = 0;
	for (const [index, key] of keys.entries()) {
		const word = words[index];
		if (word === undefined) break;
		const open = bounds.at(-1);
		if (index < closesAt && open !== undefined) {
			bounds[bounds.length - 1] = { start: open.start, end: word.end };
			continue;
		}
		const balancedAt = keys.indexOf(key, index + 1);
		closesAt = balancedAt < 0 ? index + 1 : balancedAt;
		bounds.push({ start: word.start, end: word.end });
	}
	return bounds.map(({ start, end }) => ({ text: text.slice(start - offset, end - offset), start, end }));
}

function balances(words: readonly Part[]): readonly Balance[] {
	const totals = [UNMARKED];
	let total = UNMARKED;
	for (const { text } of words) {
		if (BALANCE_MARKERS.test(text)) total = markedBy(total, text);
		totals.push(total);
	}
	return totals;
}

function markedBy(total: Balance, text: string): Balance {
	return {
		ticks: total.ticks + occurrences(text, "`"),
		stars: total.stars + occurrences(text, "**"),
		depth: total.depth + occurrences(text, "[") - occurrences(text, "]"),
	};
}

function occurrences(text: string, marker: string): number {
	return text.split(marker).length - 1;
}

function fitted(part: Part, room: number, measure: Measure): readonly Piece[] {
	const width = measure(part.text);
	const whole: Piece = { ...part, width, joint: "space" };
	if (width <= room) return [whole];
	const links = grouped(part.text, part.start, linkBalance);
	if (links.length > 1) return links.flatMap((link) => fitted(link, room, measure));
	if (part.text.includes(LINK_TARGET)) return [whole];
	const words = partsOf(part.text, part.start);
	return words.length > 1 ? words.flatMap((word) => fitted(word, room, measure)) : hardBroken(part, room, measure);
}

function hardBroken(word: Part, room: number, measure: Measure): readonly Piece[] {
	const graphemes = Array.from(GRAPHEMES.segment(word.text), ({ segment }) => segment);
	const pieces: Piece[] = [];
	let first = 0;
	while (first < graphemes.length) {
		const end = chunkEnd(graphemes, first, room, measure);
		const text = graphemes.slice(first, end).join("");
		const start = pieces.at(-1)?.end ?? word.start;
		pieces.push({ text, start, end: start + text.length, width: measure(text), joint: first === 0 ? "space" : "flush" });
		first = end;
	}
	return pieces;
}

function chunkEnd(graphemes: readonly string[], first: number, room: number, measure: Measure): number {
	const fits = (end: number): boolean => measure(graphemes.slice(first, end).join("")) <= room;
	const cellsEnd = cellsFittingEnd(graphemes, first, room);
	return clearOfBackticks(graphemes, first, fits(cellsEnd) ? cellsEnd : widestFit(fits, first + 1, cellsEnd - 1));
}

function clearOfBackticks(graphemes: readonly string[], first: number, end: number): number {
	if (end <= first + 1 || end >= graphemes.length) return end;
	const touches = graphemes[end - 1] === "`" || graphemes[end] === "`";
	return touches ? clearOfBackticks(graphemes, first, end - 1) : end;
}

function cellsFittingEnd(graphemes: readonly string[], first: number, room: number): number {
	const window = graphemes.slice(first, first + room + 1);
	let cells = 0;
	for (const [offset, grapheme] of window.entries()) {
		cells += visibleWidth(grapheme);
		if (cells > room) return first + Math.max(1, offset);
	}
	return first + window.length;
}

function widestFit(fits: (end: number) => boolean, low: number, high: number): number {
	if (low >= high) return low;
	const middle = Math.ceil((low + high) / 2);
	return fits(middle) ? widestFit(fits, middle, high) : widestFit(fits, low, middle - 1);
}

function packed(pieces: readonly Piece[], room: number): readonly Row[] {
	const rows: Row[] = [];
	for (const piece of pieces) {
		const last = rows.at(-1);
		const grown = last === undefined ? undefined : grownRow(last, piece, room);
		if (grown === undefined) rows.push({ start: piece.start, end: piece.end, width: piece.width, gaps: 0 });
		else rows[rows.length - 1] = grown;
	}
	return rows;
}

function grownRow(row: Row, piece: Piece, room: number): Row | undefined {
	if (piece.joint === "flush") return undefined;
	if (piece.width === 0) return { ...row, end: piece.end, gaps: row.gaps + 1 };
	const width = row.width + row.gaps + 1 + piece.width;
	return width <= room ? { start: row.start, end: piece.end, width, gaps: 0 } : undefined;
}

function closedAcrossRows(line: string, rows: readonly Row[]): readonly string[] {
	const spans = line.includes("`") ? codeSpans(line) : [];
	const reopened = rows.map((row, index) => {
		const above = rows[index - 1];
		return above === undefined ? "" : fenceAcross(spans, above.end, row.start);
	});
	return rows.map((row, index) => `${reopened[index] ?? ""}${line.slice(row.start, row.end)}${reopened[index + 1] ?? ""}`);
}

function fenceAcross(spans: readonly CodeSpan[], upperEnd: number, lowerStart: number): string {
	return spans.find((span) => span.from < upperEnd && lowerStart < span.to)?.fence ?? "";
}

function codeSpans(line: string): readonly CodeSpan[] {
	const runs = Array.from(line.matchAll(BACKTICK_RUN), (match) => ({ fence: match[0], at: match.index }));
	const spans: CodeSpan[] = [];
	let pairedUntil = 0;
	for (const [index, opener] of runs.entries()) {
		if (index < pairedUntil || escapedAt(line, opener.at)) continue;
		const closing = runs.findIndex((run, at) => at > index && run.fence === opener.fence);
		const closer = runs[closing];
		if (closer === undefined) continue;
		spans.push({ fence: opener.fence, from: opener.at + opener.fence.length, to: closer.at });
		pairedUntil = closing + 1;
	}
	return spans;
}

function escapedAt(line: string, at: number): boolean {
	return backslashesBefore(line, at) % 2 === 1;
}

function backslashesBefore(line: string, at: number): number {
	return line[at - 1] === "\\" ? 1 + backslashesBefore(line, at - 1) : 0;
}
