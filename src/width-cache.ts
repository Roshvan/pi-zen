import type { Component } from "@earendil-works/pi-tui";

type Drawn = {
	readonly width: number;
	readonly lines: string[];
};

export function widthCached(draw: (width: number) => string[], parts: readonly Component[]): Component {
	let drawn: Drawn | undefined;
	return {
		render: (width) => {
			if (drawn?.width !== width) drawn = { width, lines: draw(width) };
			return drawn.lines;
		},
		invalidate: () => {
			drawn = undefined;
			for (const part of parts) part.invalidate();
		},
	};
}
