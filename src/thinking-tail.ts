const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;

/** Lines retained on terminals with enough vertical room. */
export const DEFAULT_THINKING_TAIL_LINES = 8;

/** Lines retained when the terminal is short. */
export const SHORT_THINKING_TAIL_LINES = 5;

/** A terminal at or below this height gets the shorter reasoning tail. */
export const SHORT_TERMINAL_ROWS = 24;

/**
 * Choose a reasoning-tail budget from the terminal's current height.
 *
 * @param terminalRows - Current terminal rows, or undefined outside a measurable TTY.
 * @returns The number of streaming reasoning lines to retain.
 */
export function thinkingTailLineBudget(terminalRows: number | undefined): number {
	return terminalRows !== undefined && terminalRows <= SHORT_TERMINAL_ROWS
		? SHORT_THINKING_TAIL_LINES
		: DEFAULT_THINKING_TAIL_LINES;
}

/**
 * Keep only the end of a reasoning block while it is still streaming.
 *
 * Reasoning is worth reading, but a block that grows without limit pushes the
 * rest of the turn off the screen and scrolls while you read it. Holding it to a
 * fixed number of lines keeps the transcript still: the block stays the same
 * height and the newest sentence stays where your eye already is. Once the block
 * settles it is shown whole, because by then it is history rather than motion.
 *
 * @param markdown - The reasoning text so far.
 * @param maxLines - How many lines to keep.
 * @returns The last `maxLines` lines, marked as a tail when anything was cut.
 */
export function thinkingTail(markdown: string, maxLines: number): string {
	if (maxLines <= 0) return "";

	const lines = markdown.split("\n");
	if (lines.length <= maxLines) return markdown;

	const tail = lines.slice(lines.length - maxLines);
	// Cutting into a code fence would leave the renderer with an unclosed one, so
	// an odd number of fences in the tail gets an opener of its own.
	let fences = 0;
	for (const line of tail) if (FENCE.test(line)) fences += 1;
	if (fences % 2 === 1) tail.unshift("```");

	return ["…", ...tail].join("\n");
}
