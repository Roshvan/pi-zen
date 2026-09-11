import type {
	ExtensionContext,
	MessageEndEvent,
	MessageStartEvent,
	MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";

import { advance, beginRun, formatTurnStatus, type TurnPhase, type TurnTiming, type TurnTokens } from "./turn-timing.ts";
import { QUIET_INTERVAL_MS } from "./working-indicator.ts";

const WIDGET_KEY = "zen-turn-status";
const WIDGET_INDENT = 1;
const FALLBACK_COLUMNS = 80;

type StreamedMessage = Extract<MessageUpdateEvent["message"], { role: "assistant" }>;

function tokensOf(message: StreamedMessage): TurnTokens {
	return { input: message.usage.input, output: message.usage.output };
}

function phaseOf(message: StreamedMessage): TurnPhase | undefined {
	const latest = message.content.at(-1);
	if (latest === undefined) return undefined;
	return latest.type === "thinking" ? "thinking" : "writing";
}

export class TurnStatus {
	private timing: TurnTiming = beginRun();
	private ticker: ReturnType<typeof setInterval> | undefined;
	private context: ExtensionContext | undefined;

	begin(ctx: ExtensionContext): void {
		this.context = ctx;
		this.timing = beginRun();
		this.startTicking();
		this.render();
	}

	open(event: MessageStartEvent, ctx: ExtensionContext): void {
		if (event.message.role !== "assistant") return;

		this.context = ctx;
		this.timing = advance(this.timing, { kind: "opened" }, Date.now());
		this.render();
	}

	update(event: MessageUpdateEvent, ctx: ExtensionContext): void {
		if (event.message.role !== "assistant") return;

		this.context = ctx;
		const phase = phaseOf(event.message);
		if (phase !== undefined) {
			const live = tokensOf(event.message);
			this.timing = advance(this.timing, { kind: "producing", phase, live }, Date.now());
		}
		this.render();
	}

	commit(event: MessageEndEvent, ctx: ExtensionContext): void {
		if (event.message.role !== "assistant") return;

		this.context = ctx;
		this.timing = advance(this.timing, { kind: "settled", tokens: tokensOf(event.message) }, Date.now());
		this.render();
	}

	end(ctx: ExtensionContext): void {
		this.context = ctx;
		this.timing = advance(this.timing, { kind: "closed" }, Date.now());
		this.stopTicking();
		this.render();
	}

	clear(ctx: ExtensionContext): void {
		this.context = ctx;
		this.timing = beginRun();
		this.stopTicking();
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	private startTicking(): void {
		this.stopTicking();
		this.ticker = setInterval(() => this.render(), QUIET_INTERVAL_MS);
		this.ticker.unref();
	}

	private stopTicking(): void {
		if (this.ticker === undefined) return;
		clearInterval(this.ticker);
		this.ticker = undefined;
	}

	private render(): void {
		const ctx = this.context;
		if (ctx === undefined) return;

		const columns = process.stdout.columns ?? FALLBACK_COLUMNS;
		const line = formatTurnStatus(this.timing, Date.now(), columns - WIDGET_INDENT);
		ctx.ui.setWidget(WIDGET_KEY, line === "" ? undefined : [ctx.ui.theme.fg("muted", line)]);
	}
}
