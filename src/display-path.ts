import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { visibleWidth } from "@earendil-works/pi-tui";

const READABLE_PATH = 56;
const ELLIPSIS = "…";
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const SEPARATORS = sep === "/" ? /\/+/ : /[\\/]+/;

export function displayPath(path: string, cwd: string): string {
	if (path === "") return path;

	const absolute = resolve(cwd, path);
	const inside = relative(cwd, absolute);
	if (inside === "") return ".";
	if (inside !== ".." && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)) return shortenPath(inside, READABLE_PATH);

	const home = homedir();
	const inHome = home !== "" && absolute.startsWith(`${home}${sep}`);
	return shortenPath(inHome ? `~${absolute.slice(home.length)}` : absolute, READABLE_PATH);
}

export function shortenPath(path: string, max: number): string {
	if (max <= 0) return "";
	if (visibleWidth(path) <= max) return path;

	const parts = path.split(SEPARATORS).filter((part) => part.length > 0);
	const file = parts.at(-1);
	if (file === undefined || parts.length === 1) return keepEnd(file ?? path, max);

	const tails = parts
		.slice(0, -1)
		.reverse()
		.reduce<readonly string[]>((grown, segment) => [...grown, `${segment}${sep}${grown.at(-1) ?? file}`], [file]);
	const longest = tails.filter((tail) => visibleWidth(`${ELLIPSIS}${sep}${tail}`) <= max).at(-1);
	return longest === undefined ? keepEnd(file, max) : `${ELLIPSIS}${sep}${longest}`;
}

function keepEnd(text: string, max: number): string {
	if (visibleWidth(text) <= max) return text;
	const room = max - visibleWidth(ELLIPSIS);
	if (room <= 0) return ELLIPSIS.slice(0, max);

	const graphemes = Array.from(GRAPHEMES.segment(text), (part) => part.segment);
	const widths = graphemes.map((grapheme) => visibleWidth(grapheme));
	const start = widths.findIndex((_width, index) => widths.slice(index).reduce((sum, width) => sum + width, 0) <= room);
	return ELLIPSIS + (start === -1 ? "" : graphemes.slice(start).join(""));
}
