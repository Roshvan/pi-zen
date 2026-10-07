import { stripVTControlCharacters } from "node:util";

import { getLanguageFromPath, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, sliceByColumn, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { widthCached } from "./width-cache.ts";

export type SourceFile = {
	readonly path: string;
	readonly text: string;
	readonly startLine: number;
};

type Gutter = {
	readonly numbered: (lineNumber: number) => string;
	readonly continued: string;
};

const TAB = "   ";
const RAIL = " │ ";
const LEADING_SPACE = /^ */;

function isBlank(line: string): boolean {
	return stripVTControlCharacters(line).trim() === "";
}

function withoutTrailingBlanks(lines: readonly string[]): readonly string[] {
	const last = lines.reduce((found, line, index) => (isBlank(line) ? found : index), -1);
	return lines.slice(0, last + 1);
}

function frameLine(line: string, lineNumber: number, room: number, gutter: Gutter): string[] {
	const indent = LEADING_SPACE.exec(stripVTControlCharacters(line))?.[0] ?? "";
	const width = visibleWidth(line);
	const hangs = width > room && indent.length > 0 && indent.length * 2 <= room;
	const body = hangs ? sliceByColumn(line, indent.length, width - indent.length) : line;
	const bodyRoom = hangs ? room - indent.length : room;
	const chunks = visibleWidth(body) <= bodyRoom ? [body] : wrapTextWithAnsi(body, bodyRoom);
	const hang = hangs ? indent : "";
	return chunks.map((chunk, index) => (index === 0 ? gutter.numbered(lineNumber) : gutter.continued) + hang + chunk);
}

function frameSource(lines: readonly string[], startLine: number, width: number, theme: Theme): string[] {
	const kept = withoutTrailingBlanks(lines);
	const gutterWidth = Math.max(2, String(startLine + kept.length - 1).length);
	const room = width - gutterWidth - RAIL.length;
	if (kept.length === 0 || room <= 0) return [];

	const gutter: Gutter = {
		numbered: (lineNumber) => theme.fg("dim", `${String(lineNumber).padStart(gutterWidth, " ")}${RAIL}`),
		continued: theme.fg("dim", `${" ".repeat(gutterWidth)}${RAIL}`),
	};
	return kept.flatMap((line, index) => frameLine(line, startLine + index, room, gutter));
}

export function sourceLayout(file: SourceFile, theme: Theme): Component {
	const colored = highlightCode(file.text.replaceAll("\t", TAB), getLanguageFromPath(file.path));
	return widthCached((width) => frameSource(colored, file.startLine, width, theme), []);
}
