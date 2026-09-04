import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/** Name used only while Zen's backgroundless projection is active. */
export const BACKGROUNDLESS_THEME_NAME = "pi-zen:backgroundless";

const THEME_COLORS = [
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"searchMatchText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"thinkingMax",
	"bashMode",
] as const satisfies ReadonlyArray<ThemeColor>;

type ThemeBackground = Parameters<Theme["bg"]>[0] | "scrollbarThumb";

type LegacyScrollbarTheme = {
	readonly getBgAnsi: (color: ThemeBackground) => string;
};

const THEME_BACKGROUNDS = [
	"selectedBg",
	"searchMatchBg",
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
] as const satisfies ReadonlyArray<ThemeBackground>;

const CONTENT_BACKGROUNDS: ReadonlySet<ThemeBackground> = new Set([
	"userMessageBg",
	"customMessageBg",
	"toolPendingBg",
	"toolSuccessBg",
	"toolErrorBg",
]);

/** Foregrounds designed for a colored surface need a terminal-safe counterpart once that surface is gone. */
function backgroundlessForeground(color: ThemeColor): ThemeColor {
	if (color === "userMessageText" || color === "customMessageText" || color === "toolOutput") return "text";
	return color;
}

type ForegroundInput = ConstructorParameters<typeof Theme>[0];
type BackgroundInput = ConstructorParameters<typeof Theme>[1];

type ThemeSnapshotOptions = {
	readonly name: string | undefined;
	readonly suppressContentBackgrounds: boolean;
};

function emptyForegrounds(): ForegroundInput {
	// SAFETY: THEME_COLORS is checked against ThemeColor and contains every required key exactly once.
	return Object.fromEntries(THEME_COLORS.map((color) => [color, ""])) as ForegroundInput;
}

function emptyBackgrounds(): BackgroundInput {
	// SAFETY: THEME_BACKGROUNDS is checked against ThemeBackground and contains every required key exactly once.
	return Object.fromEntries(THEME_BACKGROUNDS.map((color) => [color, ""])) as BackgroundInput;
}

function captureScrollbarColors(
	source: Theme,
	foregroundAnsi: Map<ThemeColor, string>,
	backgroundAnsi: Map<ThemeBackground, string>,
): void {
	let thumb: string;
	try {
		thumb = source.getFgAnsi("scrollbarThumb");
	} catch (error) {
		if (!(error instanceof Error) || error.message !== "Unknown theme color: scrollbarThumb") throw error;
		// SAFETY: Pi 0.84.x reports this missing foreground because its thumb is a background token.
		// The current Theme type omits that legacy key; its getter still checks the key at runtime.
		const legacySource = source as LegacyScrollbarTheme;
		backgroundAnsi.set("scrollbarThumb", legacySource.getBgAnsi("scrollbarThumb"));
		return;
	}
	foregroundAnsi.set("scrollbarThumb", thumb);
	foregroundAnsi.set("scrollbarTrack", source.getFgAnsi("scrollbarTrack"));
}

function makeThemeSnapshot(source: Theme, options: ThemeSnapshotOptions): Theme {
	const foregroundAnsi = new Map<ThemeColor, string>();
	const backgroundAnsi = new Map<ThemeBackground, string>();
	for (const color of THEME_COLORS) foregroundAnsi.set(color, source.getFgAnsi(color));
	for (const color of THEME_BACKGROUNDS) backgroundAnsi.set(color, source.getBgAnsi(color));
	captureScrollbarColors(source, foregroundAnsi, backgroundAnsi);

	// SAFETY: Pi created source, so its constructor is the runtime's Theme constructor. Using that exact constructor
	// keeps instanceof checks valid when this source package has a different development copy of Pi installed.
	const RuntimeTheme = source.constructor as typeof Theme;
	const snapshot = new RuntimeTheme(
		emptyForegrounds(),
		emptyBackgrounds(),
		source.getColorMode(),
		options.name === undefined ? {} : { name: options.name },
	);

	snapshot.getFgAnsi = (color: ThemeColor): string => {
		const projectedColor = options.suppressContentBackgrounds ? backgroundlessForeground(color) : color;
		const ansi = foregroundAnsi.get(projectedColor);
		if (ansi === undefined) throw new Error(`Unknown theme color: ${color}`);
		return ansi;
	};
	const getBgAnsi = (color: ThemeBackground): string => {
		if (options.suppressContentBackgrounds && CONTENT_BACKGROUNDS.has(color)) return "\x1b[49m";
		const ansi = backgroundAnsi.get(color);
		if (ansi === undefined) throw new Error(`Unknown theme background: ${color}`);
		return ansi;
	};
	snapshot.getBgAnsi = getBgAnsi;
	snapshot.fg = (color: ThemeColor, text: string): string => `${snapshot.getFgAnsi(color)}${text}\x1b[39m`;
	snapshot.bg = (color: ThemeBackground, text: string): string => {
		if (options.suppressContentBackgrounds && CONTENT_BACKGROUNDS.has(color)) return text;
		return `${getBgAnsi(color)}${text}\x1b[49m`;
	};

	return snapshot;
}

/**
 * Capture the active theme so Zen can restore it without depending on mutable global theme state.
 *
 * @param source - Pi's currently active theme.
 * @returns An in-memory copy of the active theme.
 */
export function snapshotTheme(source: Theme): Theme {
	return makeThemeSnapshot(source, { name: source.name, suppressContentBackgrounds: false });
}

/**
 * Keep the active theme while removing message and tool backgrounds.
 * Surface-specific body text falls back to the theme's terminal-safe base text;
 * selection and search backgrounds, plus scrollbar colors, remain as affordances.
 *
 * @param source - Pi's currently active theme.
 * @returns A backgroundless projection of the active theme.
 */
export function withoutContentBackgrounds(source: Theme): Theme {
	return makeThemeSnapshot(source, { name: BACKGROUNDLESS_THEME_NAME, suppressContentBackgrounds: true });
}
