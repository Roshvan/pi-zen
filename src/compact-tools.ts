import {
	type AgentToolResult,
	type BashToolDetails,
	type BashToolOptions,
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type EditToolDetails,
	type ExtensionAPI,
	type FindToolDetails,
	type GrepToolDetails,
	type LsToolDetails,
	type ReadToolDetails,
	type Theme,
	type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, Container, Text } from "@earendil-works/pi-tui";

import {
	type BuiltinCallSlot,
	type BuiltinResultSlot,
	forwardCall,
	type ForwardedRenderContext,
	forwardResult,
} from "./builtin-render.ts";
import { type CallGrouper, formatGroupLine, type GroupLabel, type GroupSlot } from "./call-group.ts";
import { compactDiff, type DiffLine, MAX_DIFF_LINES, renderDiff } from "./edit-diff.ts";
import { displayPath } from "./display-path.ts";
import {
	bashFailureSummary,
	commandHead,
	countMatchLines,
	countPatchChanges,
	countPatchHunks,
	countResultLines,
	firstActionableLine,
	hasImage,
	formatDuration,
	formatEditChange,
	textOf,
} from "./tool-output.ts";
import { formatToolRow, type RowDetail, type RowOutcome, type RowPalette, type RowSubject } from "./tool-row.ts";

/** Options Pi built its own tools with, so an override runs them identically. */
export type BuiltinToolOptions = {
	/** Whether the read tool resizes large images. */
	readonly autoResizeImages: boolean;
	/** Shell setup commands prepended to every bash command. */
	readonly shellCommandPrefix: string | undefined;
	/** Explicit shell binary for the bash tool. */
	readonly shellPath: string | undefined;
};

/** Lines of streaming output shown under an expanded row that is still running. */
const STREAMING_TAIL_LINES = 10;

/**
 * Per-row state pi shares between the two render slots.
 *
 * `startedAt` and `endedAt` are the names pi's own bash renderer uses on this
 * object. An expanded row forwards this same state to the built-in slots, so
 * writing the timings here is what lets pi's expanded view report the real
 * duration of a call whose collapsed row we rendered ourselves.
 */
type RowMemory = {
	startedAt: number | undefined;
	endedAt: number | undefined;
	builtinCallComponent: Component | undefined;
	builtinResultComponent: Component | undefined;
	groupSlot: GroupSlot | undefined;
	groupCounted: boolean | undefined;
};

type RowView<TArgs> = {
	readonly args: TArgs;
	readonly state: RowMemory;
	readonly lastComponent: Component | undefined;
	readonly cwd: string;
	readonly executionStarted: boolean;
	readonly isPartial: boolean;
	readonly expanded: boolean;
	readonly isError: boolean;
};

function rowView<TArgs>(context: ForwardedRenderContext): RowView<TArgs> {
	return context;
}

/** How a tool's arguments and result become one row. */
type RowSpec<TArgs, TDetails> = {
	/** Present-tense action, at most five columns. */
	readonly verb: string;
	/** The label this tool folds under, or undefined for a tool that always keeps its own row. */
	readonly group: GroupLabel | undefined;
	/** What the tool acted on. */
	readonly subject: (args: TArgs, cwd: string) => RowSubject;
	/** Detail shown once the call settles successfully. */
	readonly detail: (result: AgentToolResult<TDetails>, args: TArgs, elapsedMs: number | undefined) => RowDetail | undefined;
	/** Reason shown when the call fails. Defaults to the first line of output. */
	readonly failure?: (output: string) => string | undefined;
	/** Lines shown under a settled row, for a tool whose change is the point of it. */
	readonly body?: (result: AgentToolResult<TDetails>) => readonly DiffLine[] | undefined;
};

/** A row that renders itself at the terminal's current width. */
class ToolRowComponent implements Component {
	private verb: string;
	private subject: RowSubject;
	private detail: RowDetail | undefined;
	private outcome: RowOutcome;
	private palette: RowPalette;
	private body: readonly DiffLine[] | undefined;
	private slot: GroupSlot | undefined;

	constructor(
		verb: string,
		subject: RowSubject,
		detail: RowDetail | undefined,
		outcome: RowOutcome,
		palette: RowPalette,
		body: readonly DiffLine[] | undefined,
		slot: GroupSlot | undefined,
	) {
		this.verb = verb;
		this.subject = subject;
		this.detail = detail;
		this.outcome = outcome;
		this.palette = palette;
		this.body = body;
		this.slot = slot;
	}

	/**
	 * Replace what the row shows.
	 *
	 * @param verb - Present-tense action.
	 * @param subject - What the tool acted on.
	 * @param detail - Outcome detail, when there is one.
	 * @param outcome - Where the call has got to.
	 * @param palette - The active theme.
	 * @param body - Diff lines to show under the row, when there are any.
	 * @param slot - This call's place in a run of folded calls, if it is in one.
	 */
	update(
		verb: string,
		subject: RowSubject,
		detail: RowDetail | undefined,
		outcome: RowOutcome,
		palette: RowPalette,
		body: readonly DiffLine[] | undefined,
		slot: GroupSlot | undefined,
	): void {
		this.verb = verb;
		this.subject = subject;
		this.detail = detail;
		this.outcome = outcome;
		this.palette = palette;
		this.body = body;
		this.slot = slot;
	}

	/** Required by Pi's component contract; the row holds no cached layout. */
	invalidate(): void {}

	/**
	 * Render the row, or the line that stands in for its whole run.
	 *
	 * Every choice here is made at render time rather than when the call settled,
	 * because pi renders a component on every frame but only asks the render slots
	 * again when something changes. A folded call therefore has to be able to
	 * change its mind: to become a count when a second call joins its run, or to
	 * start showing its run's line when the call that was showing it drops out.
	 *
	 * @param width - Available terminal width.
	 * @returns The lines to draw, which may be none.
	 */
	render(width: number): string[] {
		const slot = this.slot;
		if (slot !== undefined) {
			if (!slot.group.leads(slot.id)) return [];
			if (slot.group.total() > 1) return [formatGroupLine(slot.group.snapshot(), width, this.palette)];
		}

		const row = formatToolRow(
			{ verb: this.verb, subject: this.subject, detail: this.detail, outcome: this.outcome },
			width,
			this.palette,
		);
		if (this.body === undefined) return [row];
		return [row, ...renderDiff(this.body, width, this.palette)];
	}
}

function rowComponent(
	last: Component | undefined,
	verb: string,
	subject: RowSubject,
	detail: RowDetail | undefined,
	outcome: RowOutcome,
	palette: RowPalette,
	body?: readonly DiffLine[] | undefined,
	slot?: GroupSlot | undefined,
): Component {
	if (last instanceof ToolRowComponent) {
		last.update(verb, subject, detail, outcome, palette, body, slot);
		return last;
	}
	return new ToolRowComponent(verb, subject, detail, outcome, palette, body, slot);
}

function streamingTail(output: string, theme: Theme): Component {
	const lines = output.split("\n").filter((line) => line.trim() !== "");
	const tail = lines.slice(-STREAMING_TAIL_LINES);
	if (tail.length === 0) return new Container();
	return new Text(tail.map((line) => theme.fg("dim", line)).join("\n"), 2, 0);
}

function elapsedOf(memory: RowMemory): number | undefined {
	const startedAt = memory.startedAt;
	const endedAt = memory.endedAt;
	if (startedAt === undefined || endedAt === undefined) return undefined;
	return endedAt - startedAt;
}

function boxed(component: Component): Component {
	const box = new Box(1, 0);
	box.addChild(component);
	return box;
}

/**
 * Build the Zen render slots for one built-in tool.
 *
 * Collapsed rows are one line; an expanded row is rendered by Pi's own built-in
 * slots, so diffs, syntax highlighting, images, and truncation notices are
 * unchanged. While a call is still running, an expanded row shows the tail of
 * the streaming output instead, which keeps Pi's per-second refresh timers out
 * of the picture.
 *
 * @template TArgs - The tool's argument type.
 * @template TDetails - The tool's result detail type.
 * @param spec - How this tool's arguments and result become a row.
 * @param builtinCall - The built-in `renderCall`.
 * @param builtinResult - The built-in `renderResult`.
 * @param grouper - Tracks the open run of folded calls.
 * @param isActive - Whether Zen currently owns the presentation.
 * @returns The `renderCall` and `renderResult` slots to register.
 */
function zenSlots<TArgs, TDetails>(
	spec: RowSpec<TArgs, TDetails>,
	builtinCall: BuiltinCallSlot<TArgs> | undefined,
	builtinResult: BuiltinResultSlot<TDetails> | undefined,
	grouper: CallGrouper,
	isActive: () => boolean,
) {
	return {
		renderCall: (args: TArgs, theme: Theme, context: ForwardedRenderContext): Component => {
			const view = rowView<TArgs>(context);
			const memory = view.state;
			if (view.executionStarted && memory.startedAt === undefined) memory.startedAt = Date.now();
			// Joined while the call is still streaming, so the run's line lands at the
			// position of the first call in the run, not the first one to come back.
			if (spec.group !== undefined && isActive()) memory.groupSlot ??= grouper.claim();

			// Zen off, or a row the user expanded: pi renders its own call, in full.
			if (!isActive() || (view.expanded && !view.isPartial)) {
				const forwarded = forwardCall(builtinCall, args, theme, context, memory.builtinCallComponent);
				memory.builtinCallComponent = forwarded;
				return forwarded ?? new Container();
			}
			if (!view.isPartial) return new Container();

			return rowComponent(
				view.lastComponent,
				spec.verb,
				spec.subject(args, view.cwd),
				undefined,
				{ kind: "running" },
				theme,
			);
		},

		renderResult: (
			result: AgentToolResult<TDetails>,
			options: ToolRenderResultOptions,
			theme: Theme,
			context: ForwardedRenderContext,
		): Component => {
			const view = rowView<TArgs>(context);
			const memory = view.state;

			const zenOff = !isActive();
			if (options.isPartial && !zenOff) {
				return view.expanded ? streamingTail(textOf(result.content), theme) : new Container();
			}

			// A settled row must report a fixed duration, not one that grows on every
			// redraw — and a call that is still streaming has not ended at all.
			if (!options.isPartial) memory.endedAt ??= Date.now();

			if (zenOff || view.expanded) {
				const forwarded = forwardResult(builtinResult, result, options, theme, context, memory.builtinResultComponent);
				memory.builtinResultComponent = forwarded;
				if (forwarded === undefined) return new Container();
				// The box replaces the padding pi's own shell would have put around it.
				return zenOff ? forwarded : boxed(forwarded);
			}

			if (view.isError) {
				// A failure is an outcome, so it always keeps its own row — and it closes the
				// open run, so the transcript still reads in the order things happened.
				grouper.close();
				const slot = memory.groupSlot;
				if (slot !== undefined) slot.group.leave(slot.id);
				const failureOf = spec.failure ?? firstActionableLine;
				const failed: RowOutcome = { kind: "failed", reason: failureOf(textOf(result.content)) };
				return rowComponent(view.lastComponent, spec.verb, spec.subject(view.args, view.cwd), undefined, failed, theme);
			}

			if (spec.group === undefined) {
				// A code edit is what the user came to see, so it interrupts the run.
				grouper.close();
			} else {
				const slot = memory.groupSlot;
				if (slot !== undefined && !memory.groupCounted) {
					slot.group.add(spec.group);
					memory.groupCounted = true;
				}
			}

			const detail = spec.detail(result, view.args, elapsedOf(memory));
			const settled: RowOutcome = { kind: "settled" };
			const body = spec.body?.(result);
			return rowComponent(
				view.lastComponent,
				spec.verb,
				spec.subject(view.args, view.cwd),
				detail,
				settled,
				theme,
				body,
				memory.groupSlot,
			);
		},
	};
}

function quiet(text: string): RowDetail {
	return { text, emphasis: "quiet" };
}

function attention(text: string): RowDetail {
	return { text, emphasis: "attention" };
}

function pathSubject(path: string | undefined, cwd: string): RowSubject {
	return { text: path === undefined || path === "" ? "…" : displayPath(path, cwd), keep: "end" };
}

function truncationDetail(truncated: boolean | undefined, fallback: RowDetail | undefined): RowDetail | undefined {
	if (truncated !== true) return fallback;
	return attention(fallback === undefined ? "truncated" : `${fallback.text} · truncated`);
}

function bashOptionsFrom(options: BuiltinToolOptions): BashToolOptions {
	// Assigned field by field: Pi's options are optional properties, and this
	// project forbids handing them an explicit undefined.
	const bash: Pick<BashToolOptions, "commandPrefix" | "shellPath"> = {};
	if (options.shellCommandPrefix !== undefined) bash.commandPrefix = options.shellCommandPrefix;
	if (options.shellPath !== undefined) bash.shellPath = options.shellPath;
	return bash;
}

/**
 * Register one-line renderers for Pi's built-in tools.
 *
 * Pi resolves renderers per slot but only from a registered tool, so each
 * override re-creates the built-in definition — with the same options the app
 * built it from — and replaces nothing but the two render slots. Execution,
 * schemas, prompt metadata, cancellation, truncation, and result details all
 * stay the built-in behaviour.
 *
 * @param pi - The extension API.
 * @param cwd - The session's working directory.
 * @param options - The options Pi built its own tools with.
 * @param grouper - Tracks the open run of folded calls.
 * @param isActive - Whether Zen currently owns the presentation.
 */
export function registerCompactTools(
	pi: ExtensionAPI,
	cwd: string,
	options: BuiltinToolOptions,
	grouper: CallGrouper,
	isActive: () => boolean,
): void {
	const read = createReadToolDefinition(cwd, { autoResizeImages: options.autoResizeImages });
	pi.registerTool({
		...read,
		renderShell: "self",
		...zenSlots<{ path: string; offset?: number; limit?: number }, ReadToolDetails | undefined>(
			{
				verb: "read",
				group: "read",
				subject: (args, sessionCwd) => pathSubject(args.path, sessionCwd),
				detail: (result, args) => {
					if (hasImage(result.content)) return quiet("image");
					const range = args.offset === undefined ? undefined : quiet(`from ${args.offset}`);
					return truncationDetail(result.details?.truncation?.truncated, range);
				},
			},
			read.renderCall,
			read.renderResult,
			grouper,
			isActive,
		),
	});

	const bash = createBashToolDefinition(cwd, bashOptionsFrom(options));
	pi.registerTool({
		...bash,
		renderShell: "self",
		...zenSlots<{ command: string; timeout?: number }, BashToolDetails | undefined>(
			{
				verb: "run",
				group: "run",
				subject: (args) => ({ text: commandHead(args.command ?? ""), keep: "start" }),
				failure: bashFailureSummary,
				detail: (result, _args, elapsedMs) => {
					const elapsed = elapsedMs === undefined ? undefined : quiet(formatDuration(elapsedMs));
					return truncationDetail(result.details?.truncation?.truncated, elapsed);
				},
			},
			bash.renderCall,
			bash.renderResult,
			grouper,
			isActive,
		),
	});

	const edit = createEditToolDefinition(cwd);
	pi.registerTool({
		...edit,
		renderShell: "self",
		...zenSlots<{ path: string; edits: { oldText: string; newText: string }[] }, EditToolDetails | undefined>(
			{
				verb: "edit",
				group: undefined,
				subject: (args, sessionCwd) => pathSubject(args.path, sessionCwd),
				body: (result) => {
					const patch = result.details?.patch;
					return patch === undefined ? undefined : compactDiff(patch);
				},
				detail: (result) => {
					const patch = result.details?.patch;
					if (patch === undefined) return undefined;
					const counts = countPatchChanges(patch);
					const change = formatEditChange(counts);
					if (change === undefined) return undefined;

					const hunks = countPatchHunks(patch);
					const isLarge = counts.added + counts.removed > MAX_DIFF_LINES;
					return quiet(isLarge && hunks > 1 ? `${change} · ${hunks} hunks` : change);
				},
			},
			edit.renderCall,
			edit.renderResult,
			grouper,
			isActive,
		),
	});

	const write = createWriteToolDefinition(cwd);
	pi.registerTool({
		...write,
		renderShell: "self",
		...zenSlots<{ path: string; content: string }, undefined>(
			{
				verb: "write",
				group: undefined,
				subject: (args, sessionCwd) => pathSubject(args.path, sessionCwd),
				detail: (_result, args) => {
					const lines = countResultLines(args.content ?? "");
					return quiet(lines === 1 ? "1 line" : `${lines} lines`);
				},
			},
			write.renderCall,
			write.renderResult,
			grouper,
			isActive,
		),
	});

	const grep = createGrepToolDefinition(cwd);
	pi.registerTool({
		...grep,
		renderShell: "self",
		...zenSlots<{ pattern: string; path?: string; glob?: string }, GrepToolDetails | undefined>(
			{
				verb: "grep",
				group: "grep",
				subject: (args) => ({ text: args.pattern ?? "…", keep: "start" }),
				detail: (result) => {
					const matches = countMatchLines(textOf(result.content));
					const summary = quiet(matches === 1 ? "1 match" : `${matches} matches`);
					if (result.details?.matchLimitReached !== undefined) return attention(`${summary.text} · limit`);
					return truncationDetail(result.details?.truncation?.truncated, summary);
				},
			},
			grep.renderCall,
			grep.renderResult,
			grouper,
			isActive,
		),
	});

	const find = createFindToolDefinition(cwd);
	pi.registerTool({
		...find,
		renderShell: "self",
		...zenSlots<{ pattern: string; path?: string }, FindToolDetails | undefined>(
			{
				verb: "find",
				group: "find",
				subject: (args) => ({ text: args.pattern ?? "…", keep: "start" }),
				detail: (result) => {
					const files = countResultLines(textOf(result.content));
					const summary = quiet(files === 1 ? "1 file" : `${files} files`);
					if (result.details?.resultLimitReached !== undefined) return attention(`${summary.text} · limit`);
					return truncationDetail(result.details?.truncation?.truncated, summary);
				},
			},
			find.renderCall,
			find.renderResult,
			grouper,
			isActive,
		),
	});

	const ls = createLsToolDefinition(cwd);
	pi.registerTool({
		...ls,
		renderShell: "self",
		...zenSlots<{ path?: string }, LsToolDetails | undefined>(
			{
				verb: "list",
				group: "list",
				subject: (args, sessionCwd) => pathSubject(args.path ?? ".", sessionCwd),
				detail: (result) => {
					const entries = countResultLines(textOf(result.content));
					const summary = quiet(entries === 1 ? "1 entry" : `${entries} entries`);
					if (result.details?.entryLimitReached !== undefined) return attention(`${summary.text} · limit`);
					return truncationDetail(result.details?.truncation?.truncated, summary);
				},
			},
			ls.renderCall,
			ls.renderResult,
			grouper,
			isActive,
		),
	});
}
