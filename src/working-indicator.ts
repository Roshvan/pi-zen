import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { LOADING_INTERVAL_MS, type Shade, loadingFrames } from "./loading-bar.ts";

type Rgb = { readonly r: number; readonly g: number; readonly b: number };

const ANSI_GRAY: Rgb = { r: 187, g: 187, b: 187 };

const ANSI16: readonly Rgb[] = [
	{ r: 0, g: 0, b: 0 },
	{ r: 187, g: 0, b: 0 },
	{ r: 0, g: 187, b: 0 },
	{ r: 187, g: 187, b: 0 },
	{ r: 0, g: 0, b: 187 },
	{ r: 187, g: 0, b: 187 },
	{ r: 0, g: 187, b: 187 },
	ANSI_GRAY,
	{ r: 85, g: 85, b: 85 },
	{ r: 255, g: 85, b: 85 },
	{ r: 85, g: 255, b: 85 },
	{ r: 255, g: 255, b: 85 },
	{ r: 85, g: 85, b: 255 },
	{ r: 255, g: 85, b: 255 },
	{ r: 85, g: 255, b: 255 },
	{ r: 255, g: 255, b: 255 },
];

const CUBE = [0, 95, 135, 175, 215, 255] as const;

function rgbOfIndexed(index: number): Rgb {
	if (index < 16) return ANSI16[index] ?? ANSI_GRAY;
	if (index >= 232) {
		const gray = 8 + (index - 232) * 10;
		return { r: gray, g: gray, b: gray };
	}
	const cube = index - 16;
	return {
		r: CUBE[Math.floor(cube / 36)] ?? 0,
		g: CUBE[Math.floor(cube / 6) % 6] ?? 0,
		b: CUBE[cube % 6] ?? 0,
	};
}

function channel(ansi: string, marker: string): string | undefined {
	const start = ansi.indexOf(marker);
	if (start === -1) return undefined;
	const rest = ansi.slice(start + marker.length);
	const end = rest.indexOf("m");
	if (end === -1) return undefined;
	return rest.slice(0, end);
}

function rgbOf(ansi: string): Rgb | undefined {
	const truecolor = channel(ansi, "\u001b[38;2;");
	if (truecolor) {
		const [r, g, b] = truecolor.split(";");
		if (r !== undefined && g !== undefined && b !== undefined) {
			return { r: Number(r), g: Number(g), b: Number(b) };
		}
	}
	const indexed = channel(ansi, "\u001b[38;5;");
	if (!indexed) return undefined;
	return rgbOfIndexed(Number(indexed));
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
	const t = Math.max(0, Math.min(1, amount));
	return {
		r: Math.round(from.r + (to.r - from.r) * t),
		g: Math.round(from.g + (to.g - from.g) * t),
		b: Math.round(from.b + (to.b - from.b) * t),
	};
}

function shadeFor(theme: ExtensionUIContext["theme"]): Shade {
	const dim = rgbOf(theme.getFgAnsi("dim"));
	const text = rgbOf(theme.getFgAnsi("text"));
	if (!dim || !text) {
		return (amount, glyph) => theme.fg(amount > 0.55 ? "text" : "dim", glyph);
	}
	return (amount, glyph) => {
		const color = mix(dim, text, amount);
		return `\u001b[38;2;${color.r};${color.g};${color.b}m${glyph}\u001b[39m`;
	};
}

export function installWorkingIndicator(ui: ExtensionUIContext): void {
	ui.setWorkingIndicator({
		frames: loadingFrames(shadeFor(ui.theme)),
		intervalMs: LOADING_INTERVAL_MS,
	});
}
