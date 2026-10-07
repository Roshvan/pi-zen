export const LOADING_INTERVAL_MS = 32;

export type Shade = (amount: number, text: string) => string;

const BAR_WIDTH = 7;
const STEPS = 28;
const CYCLE = STEPS * 2 - 2;

function lightPosition(frame: number): number {
	const step = frame % CYCLE;
	return (step < STEPS ? step : CYCLE - step) / (STEPS - 1);
}

export function loadingFrames(shade: Shade): string[] {
	return Array.from({ length: CYCLE }, (_, frame) => {
		const peak = lightPosition(frame) * (BAR_WIDTH + 1) - 0.5;
		return Array.from({ length: BAR_WIDTH }, (_, cell) => {
			const falloff = Math.max(0, 1 - Math.abs(cell - peak) / 1.7);
			return shade(falloff * falloff, "━");
		}).join("");
	});
}
