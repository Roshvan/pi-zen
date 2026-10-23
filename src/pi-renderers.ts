import type { Theme, ToolRenderers, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { type Component, Container } from "@earendil-works/pi-tui";

type CallSlot = NonNullable<ToolRenderers["renderCall"]>;
type ResultSlot = NonNullable<ToolRenderers["renderResult"]>;

export type RenderContext = Parameters<CallSlot>[2];

export type RenderedResult = Parameters<ResultSlot>[0];

type RowMemory = {
	groupOwner?: symbol | undefined;
	expanded?: boolean | undefined;
	startedAt?: number | undefined;
	endedAt?: number | undefined;
	interval?: ReturnType<typeof setInterval> | undefined;
	piCall?: Component | undefined;
	piResult?: Component | undefined;
};

export type Clock = () => number;

export function rowMemory(context: RenderContext): RowMemory {
	return context.state;
}

export function elapsedOf(context: RenderContext): number | undefined {
	if (context.durationMs !== undefined) return context.durationMs;
	const { startedAt, endedAt } = rowMemory(context);
	return startedAt === undefined || endedAt === undefined ? undefined : endedAt - startedAt;
}

export function startClock(context: RenderContext, now: Clock): void {
	if (context.executionStarted) rowMemory(context).startedAt ??= now();
}

export function settleClock(memory: RowMemory, now: Clock): void {
	memory.endedAt ??= now();
	if (memory.interval === undefined) return;
	clearInterval(memory.interval);
	memory.interval = undefined;
}

const RIGHT_MARGIN = 1;

function padded(component: Component, padding: number): Component {
	const indent = " ".repeat(padding);
	return {
		render: (width) => {
			const room = width - padding * 2 - RIGHT_MARGIN;
			return room > 0 ? component.render(room).map((line) => indent + line) : [];
		},
		invalidate: () => component.invalidate(),
	};
}

export function selfShell(renderCall: CallSlot, renderResult: ResultSlot): ToolRenderers {
	return {
		renderShell: "self",
		// Older hosts have neither outputPad nor recorded durations; keep their existing layout and clock fallback.
		renderCall: (args, theme, context) => padded(renderCall(args, theme, context), context.outputPad ?? 0),
		renderResult: (result, options, theme, context) => padded(renderResult(result, options, theme, context), context.outputPad ?? 0),
	};
}

export function nothing(): Component {
	return new Container();
}

export function piCall(
	pi: ToolRenderers | undefined,
	args: Parameters<CallSlot>[0],
	theme: Theme,
	context: RenderContext,
): Component | undefined {
	const slot = pi?.renderCall;
	if (slot === undefined) return undefined;
	const memory = rowMemory(context);
	memory.piCall = slot(args, theme, { ...context, lastComponent: memory.piCall });
	return memory.piCall;
}

export function piResult(
	pi: ToolRenderers | undefined,
	result: RenderedResult,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: RenderContext,
): Component | undefined {
	const slot = pi?.renderResult;
	if (slot === undefined) return undefined;
	const memory = rowMemory(context);
	memory.piResult = slot(result, options, theme, { ...context, lastComponent: memory.piResult });
	return memory.piResult;
}
