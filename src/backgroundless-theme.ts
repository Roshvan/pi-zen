import type { Theme, ThemeBg, ThemeColor } from "@earendil-works/pi-coding-agent";

const CONTENT_BACKGROUNDS: ReadonlySet<ThemeBg> = new Set([
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

const OPEN_CANVAS = "\x1b[49m";

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

function installedTheme(): Theme | undefined {
	return parseInstalledTheme(Object.getOwnPropertyDescriptor(globalThis, INSTALLED_THEME));
}

function backgroundlessForeground(color: ThemeColor): ThemeColor {
	if (color === "userMessageText" || color === "customMessageText" || color === "toolOutput") return "text";
	return color;
}

export function quietLiveTheme(): Theme | undefined {
	const theme = installedTheme();
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
	const theme = installedTheme();
	if (theme === undefined) return;
	const quiet = quietThemes();
	const canvas = quiet.get(theme);
	if (canvas === undefined) return;
	quiet.delete(theme);
	Object.assign(theme, canvas);
}
