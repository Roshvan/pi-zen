import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import {
	advance,
	beginRun,
	formatTurnStatus,
	type TurnPhase,
	type TurnSignal,
	type TurnTiming,
	type TurnTokens,
} from "./turn-timing.ts";
import type { UiPart } from "./ui-claim.ts";

type TurnStatus = UiPart & {
	readonly begin: () => void;
	readonly open: () => void;
	readonly produce: (phase: TurnPhase, usage: TurnTokens) => void;
	readonly commit: (usage: TurnTokens) => void;
	readonly end: () => void;
};

const WIDGET_KEY = "zen-turn-status";
const PADDING = " ";
const TICK_MS = 240;

function tokensOf(usage: TurnTokens): TurnTokens {
	return { input: usage.input, output: usage.output };
}

function statusLines(line: string, theme: Theme): string[] {
	return line === "" ? [] : [PADDING + theme.fg("muted", line)];
}

export function createTurnStatus(now: () => number): TurnStatus {
	let shownOn: ExtensionUIContext | undefined;
	let timing: TurnTiming = beginRun();
	let ticker: ReturnType<typeof setInterval> | undefined;
	let screen: TUI | undefined;

	const refresh = (): void => screen?.requestRender();

	const stopTicking = (): void => {
		if (ticker === undefined) return;
		clearInterval(ticker);
		ticker = undefined;
	};

	const startTicking = (): void => {
		stopTicking();
		ticker = setInterval(refresh, TICK_MS);
		ticker.unref();
	};

	const apply = (signal: TurnSignal): void => {
		if (shownOn === undefined) return;
		timing = advance(timing, signal, now());
		refresh();
	};

	const widget = (tui: TUI, theme: Theme): Component & { dispose(): void } => {
		screen = tui;
		return {
			render: (width) => statusLines(formatTurnStatus(timing, now(), width - PADDING.length * 2), theme),
			invalidate: () => {},
			dispose: () => {
				if (screen === tui) screen = undefined;
			},
		};
	};

	return {
		show: (ui) => {
			shownOn = ui;
			ui.setWidget(WIDGET_KEY, widget);
		},
		hide: (ui) => {
			shownOn = undefined;
			stopTicking();
			timing = beginRun();
			ui.setWidget(WIDGET_KEY, undefined);
		},
		begin: () => {
			if (shownOn === undefined) return;
			timing = beginRun();
			startTicking();
			refresh();
		},
		open: () => apply({ kind: "opened" }),
		produce: (phase, usage) => apply({ kind: "producing", phase, live: tokensOf(usage) }),
		commit: (usage) => apply({ kind: "committed", tokens: tokensOf(usage) }),
		end: () => {
			apply({ kind: "closed" });
			stopTicking();
		},
	};
}
