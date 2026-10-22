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

type QuietTheme = {
	readonly theme: Theme;
	readonly canvas: ThemeCanvas;
};

declare global {
	var piZenQuietTheme: QuietTheme | undefined;
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
	if (globalThis.piZenQuietTheme?.theme === theme) return theme;
	restoreLiveTheme();
	if (theme === undefined) return undefined;

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
	theme.fg = (color: ThemeColor, text: string): string =>
		color === "mdCodeBlockBorder" ? "" : canvas.fg.call(theme, backgroundlessForeground(color), text);
	globalThis.piZenQuietTheme = { theme, canvas };
	return theme;
}

export function restoreLiveTheme(): void {
	const quiet = globalThis.piZenQuietTheme;
	if (quiet === undefined) return;
	globalThis.piZenQuietTheme = undefined;
	Object.assign(quiet.theme, quiet.canvas);
}

export function liveSentInk(): SentInk {
	const theme = liveTheme();
	if (theme === undefined) return PLAIN_INK;
	return {
		words: theme.getFgAnsi("text"),
		mark: theme.getFgAnsi("border"),
	};
}
