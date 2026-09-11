import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type TurnPhase = "thinking" | "writing";

export type TurnTokens = {
	readonly input: number;
	readonly output: number;
};

type Accrued = {
	readonly thinkingMs: number;
	readonly writingMs: number;
	readonly committed: TurnTokens;
};

export type TurnTiming =
	| ({ readonly kind: "idle" } & Accrued)
	| ({
			readonly kind: "waiting";
			readonly openedAt: number;
			readonly live: TurnTokens;
	  } & Accrued)
	| ({
			readonly kind: "streaming";
			readonly phase: TurnPhase;
			readonly since: number;
			readonly live: TurnTokens;
	  } & Accrued);

export type TurnSignal =
	| { readonly kind: "opened" }
	| { readonly kind: "producing"; readonly phase: TurnPhase; readonly live: TurnTokens }
	| { readonly kind: "closed" }
	| { readonly kind: "settled"; readonly tokens: TurnTokens };

type TurnElapsed = {
	readonly thinkingMs: number;
	readonly writingMs: number;
};

const SEPARATOR = " · ";
const ELLIPSIS = "…";
const LEGIBLE_MS = 50;
const NO_TOKENS: TurnTokens = { input: 0, output: 0 };

function formatSeconds(ms: number): string {
	return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function formatTokenCount(count: number): string {
	if (count < 1_000) return String(Math.max(0, Math.round(count)));
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function addTokens(left: TurnTokens, right: TurnTokens): TurnTokens {
	return { input: left.input + right.input, output: left.output + right.output };
}

function settle(timing: TurnTiming, now: number, waitPhase: TurnPhase): Accrued {
	const totals = { thinkingMs: timing.thinkingMs, writingMs: timing.writingMs, committed: timing.committed };
	if (timing.kind === "idle") return totals;

	const spent = Math.max(0, now - (timing.kind === "waiting" ? timing.openedAt : timing.since));
	const phase = timing.kind === "waiting" ? waitPhase : timing.phase;

	return phase === "thinking"
		? { ...totals, thinkingMs: totals.thinkingMs + spent }
		: { ...totals, writingMs: totals.writingMs + spent };
}

function settleAsThinking(timing: TurnTiming, now: number): Accrued {
	return settle(timing, now, "thinking");
}

function elapsed(timing: TurnTiming, now: number): TurnElapsed {
	const totals = settleAsThinking(timing, now);
	return { thinkingMs: totals.thinkingMs, writingMs: totals.writingMs };
}

function tokens(timing: TurnTiming): TurnTokens {
	return timing.kind === "idle" ? timing.committed : addTokens(timing.committed, timing.live);
}

function statusSegments(timing: TurnTiming, now: number): string[] {
	const spent = elapsed(timing, now);
	const used = tokens(timing);

	const segments: string[] = [];
	if (spent.thinkingMs >= LEGIBLE_MS) segments.push(`${formatSeconds(spent.thinkingMs)} thinking`);
	if (spent.writingMs >= LEGIBLE_MS) segments.push(`${formatSeconds(spent.writingMs)} writing`);
	if (used.input > 0 || used.output > 0) {
		segments.push(`↑${formatTokenCount(used.input)} ↓${formatTokenCount(used.output)}`);
	}
	return segments;
}

function fitToWidth(segments: string[], width: number): string {
	let kept = segments.length;
	while (kept > 1 && visibleWidth(segments.slice(0, kept).join(SEPARATOR)) > width) kept -= 1;

	const body = segments.slice(0, kept).join(SEPARATOR);
	return visibleWidth(body) <= width ? body : truncateToWidth(body, width, ELLIPSIS);
}

export function beginRun(): TurnTiming {
	return { kind: "idle", thinkingMs: 0, writingMs: 0, committed: NO_TOKENS };
}

export function advance(timing: TurnTiming, signal: TurnSignal, now: number): TurnTiming {
	switch (signal.kind) {
		case "opened":
			return { kind: "waiting", openedAt: now, live: NO_TOKENS, ...settleAsThinking(timing, now) };

		case "producing": {
			if (timing.kind === "streaming" && timing.phase === signal.phase) return { ...timing, live: signal.live };

			return {
				kind: "streaming",
				phase: signal.phase,
				since: now,
				live: signal.live,
				...settle(timing, now, signal.phase),
			};
		}

		case "closed":
			return { kind: "idle", ...settleAsThinking(timing, now) };

		case "settled": {
			const totals = settleAsThinking(timing, now);
			return { kind: "idle", ...totals, committed: addTokens(totals.committed, signal.tokens) };
		}
	}
}

export function formatTurnStatus(timing: TurnTiming, now: number, width: number): string {
	if (width <= 0) return "";

	const segments = statusSegments(timing, now);
	return segments.length === 0 ? "" : fitToWidth(segments, width);
}
