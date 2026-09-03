import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

/**
 * The render context Pi hands to a tool's render slots.
 *
 * Pi does not export `ToolRenderContext`, and each built-in tool keeps a
 * private render state on it, so an expanded row forwards the context object it
 * was given rather than rebuilding one.
 */
// oxlint-disable-next-line no-explicit-any -- SAFETY: the forwarded value is always the context object Pi just passed in, with only the cached component replaced. Naming its type would mean restating Pi's private per-tool render state.
export type ForwardedRenderContext = any;

/** A built-in `renderCall` slot. */
export type BuiltinCallSlot<TArgs> = (args: TArgs, theme: Theme, context: ForwardedRenderContext) => Component;

/** A built-in `renderResult` slot. */
export type BuiltinResultSlot<TDetails> = (
	result: AgentToolResult<TDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ForwardedRenderContext,
) => Component;

/**
 * Render a built-in tool's call slot, reusing the component it returned last time.
 *
 * @template TArgs - The tool's argument type.
 * @param slot - The built-in `renderCall`, when the tool has one.
 * @param args - Arguments for this tool call.
 * @param theme - The active theme.
 * @param context - The context Pi passed to our own renderer.
 * @param lastComponent - The component this slot returned on the previous render.
 * @returns The built-in component, or undefined when the tool has no call slot.
 */
export function forwardCall<TArgs>(
	slot: BuiltinCallSlot<TArgs> | undefined,
	args: TArgs,
	theme: Theme,
	context: ForwardedRenderContext,
	lastComponent: Component | undefined,
): Component | undefined {
	if (slot === undefined) return undefined;
	return slot(args, theme, { ...context, lastComponent });
}

/**
 * Render a built-in tool's result slot, reusing the component it returned last time.
 *
 * @template TDetails - The tool's result detail type.
 * @param slot - The built-in `renderResult`, when the tool has one.
 * @param result - The settled tool result.
 * @param options - Pi's render options for this result.
 * @param theme - The active theme.
 * @param context - The context Pi passed to our own renderer.
 * @param lastComponent - The component this slot returned on the previous render.
 * @returns The built-in component, or undefined when the tool has no result slot.
 */
export function forwardResult<TDetails>(
	slot: BuiltinResultSlot<TDetails> | undefined,
	result: AgentToolResult<TDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ForwardedRenderContext,
	lastComponent: Component | undefined,
): Component | undefined {
	if (slot === undefined) return undefined;
	return slot(result, options, theme, { ...context, lastComponent });
}
