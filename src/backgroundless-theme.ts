import type { Theme, ThemeBg, ThemeColor } from "@earendil-works/pi-coding-agent";

import { PLAIN_INK, type SentInk } from "./message-orientation.ts";

const CONTENT_BACKGROUNDS: ReadonlySet<ThemeBg> = new Set([
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

const OPEN_CANVAS = "\x1b[49m";

// Colors embedded in tool rows, output, Markdown and syntax highlighting. Public
// ANSI lookups (Pi >=1.0.4) detect both stable theme proxies and palette mutation.
const RENDER_COLORS: readonly ThemeColor[] = [
	"accent", "text", "muted", "dim", "success", "error", "warning", "toolTitle", "toolOutput",
	"toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
	"mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder",
	"mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
	"syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString",
	"syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
];

export function renderPalette(theme: Pick<Theme, "getFgAnsi">): string {
	return RENDER_COLORS.map((color) => theme.getFgAnsi(color)).join("|");
}

const INSTALLED_THEME = Symbol.for("@earendil-works/pi-coding-agent:theme");

type ThemeCanvas = {
	readonly bg: Theme["bg"];
	readonly fg: Theme["fg"];
	readonly getBgAnsi: Theme["getBgAnsi"];
	readonly getFgAnsi: Theme["getFgAnsi"];
};

declare global {
	var piZenQuietThemes: WeakMap<Theme, ThemeCanvas> | undefined;
}

function quietThemes(): WeakMap<Theme, ThemeCanvas> {
	const carried = globalThis.piZenQuietThemes ?? new WeakMap<Theme, ThemeCanvas>();
	globalThis.piZenQuietThemes = carried;
	return carried;
}

function isThemeInstance(value: Theme | null | undefined): value is Theme {
	if (typeof value !== "object" || value === null) return false;
	const prototype: object | null = Object.getPrototypeOf(value);
	return prototype !== null && "getFgAnsi" in prototype && "bg" in prototype;
}

function parseInstalledTheme(slot: PropertyDescriptor | undefined): Theme | undefined {
	const installed: Theme | null | undefined = slot?.value;
	return isThemeInstance(installed) ? installed : undefined;
}

export function liveTheme(): Theme | undefined {
	return parseInstalledTheme(Object.getOwnPropertyDescriptor(globalThis, INSTALLED_THEME));
}

function backgroundlessForeground(color: ThemeColor): ThemeColor {
	if (color === "userMessageText" || color === "customMessageText" || color === "toolOutput") return "text";
	return color;
}

export function quietLiveTheme(): Theme | undefined {
	const theme = liveTheme();
	if (theme === undefined) return undefined;
	const quiet = quietThemes();
	if (quiet.has(theme)) return theme;

	const canvas: ThemeCanvas = {
		bg: theme.bg,
		fg: theme.fg,
		getBgAnsi: theme.getBgAnsi,
		getFgAnsi: theme.getFgAnsi,
	};
	theme.getBgAnsi = (color: ThemeBg): string =>
		CONTENT_BACKGROUNDS.has(color) ? OPEN_CANVAS : canvas.getBgAnsi.call(theme, color);
	theme.bg = (color: ThemeBg, text: string): string =>
		CONTENT_BACKGROUNDS.has(color) ? text : canvas.bg.call(theme, color, text);
	theme.getFgAnsi = (color: ThemeColor): string => canvas.getFgAnsi.call(theme, backgroundlessForeground(color));
	theme.fg = (color: ThemeColor, text: string): string => canvas.fg.call(theme, backgroundlessForeground(color), text);
	quiet.set(theme, canvas);
	return theme;
}

export function restoreLiveTheme(): void {
	const theme = liveTheme();
	if (theme === undefined) return;
	const quiet = quietThemes();
	const canvas = quiet.get(theme);
	if (canvas === undefined) return;
	quiet.delete(theme);
	Object.assign(theme, canvas);
}

export function liveSentInk(): SentInk {
	const theme = liveTheme();
	if (theme === undefined) return PLAIN_INK;
	return {
		words: theme.getFgAnsi("text"),
		mark: theme.getFgAnsi("border"),
	};
}
