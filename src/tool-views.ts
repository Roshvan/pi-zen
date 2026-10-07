import {
	type ExtensionAPI,
	type Theme,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, Text } from "@earendil-works/pi-tui";

import {
	type CallRuns,
	formatGroupLine,
	type GroupLabel,
	groupKey,
	OWN_SEAT,
	type RunLine,
	type RunSeat,
} from "./call-group.ts";
import { type EditDiff, editDiff, editSummary, renderDiff } from "./edit-diff.ts";
import {
	type Clock,
	elapsedOf,
	nothing,
	piCall,
	piResult,
	type RenderContext,
	type RenderedResult,
	rowMemory,
	selfShell,
	settleClock,
	startClock,
} from "./pi-renderers.ts";
import {
	builtInTool,
	type BuiltInTool,
	headingOf,
	readSpan,
	type ReadSpan,
	type ToolInput,
	toolInput,
	writtenFile,
	type WrittenFile,
} from "./tool-calls.ts";
import {
	bashFailureSummary,
	countFileLines,
	countListed,
	countMatches,
	firstActionableLine,
	isTruncated,
	reachedLimit,
	reportedPatch,
	type ToolDetails,
	toolDetails,
	type ToolOutput,
	toolOutput,
} from "./tool-results.ts";
import {
	attention,
	formatDuration,
	formatToolRow,
	plural,
	quiet,
	type RowDetail,
	type RowOutcome,
	type RowPalette,
	RUNNING,
	settled,
	type ToolRow,
} from "./tool-row.ts";
import { widthCached } from "./width-cache.ts";

const STREAMING_TAIL_LINES = 10;

type Settled<Call> = {
	readonly call: Call;
	readonly output: ToolOutput;
	readonly details: ToolDetails;
	readonly diff: EditDiff | undefined;
	readonly elapsedMs: number | undefined;
};

type RunRole = GroupLabel | "interrupts";

type ViewSpec<Call> = {
	readonly run: RunRole;
	readonly call: (input: ToolInput) => Call;
	readonly detail: (settled: Settled<Call>) => RowDetail | undefined;
	readonly failure: (output: ToolOutput) => string | undefined;
};

type ToolView = (pi: ToolRenderers | undefined, runs: CallRuns, showsZen: () => boolean, now: Clock) => ToolRenderers;

type GroupLines = {
	readonly key: string;
	readonly width: number;
	readonly lines: string[];
};

function rowComponent(row: ToolRow, diff: EditDiff | undefined, line: () => RunLine, palette: RowPalette): Component {
	const own = widthCached((width) => {
		const head = formatToolRow(row, width, palette);
		return diff === undefined ? [head] : [head, ...renderDiff(diff.lines, width, palette)];
	}, []);
	let group: GroupLines | undefined;
	return {
		invalidate: () => {
			own.invalidate();
			group = undefined;
		},
		render: (width) => {
			const shown = line();
			switch (shown.kind) {
				case "hidden":
					return [];
				case "own row":
					return own.render(width);
				case "group": {
					const key = groupKey(shown.counts);
					if (group?.key !== key || group.width !== width) {
						group = { key, width, lines: [formatGroupLine(shown.counts, width, palette)] };
					}
					return group.lines;
				}
			}
		},
	};
}

function streamingTail(output: ToolOutput, theme: Theme): Component {
	const tail = output.body
		.split("\n")
		.filter((line) => line.trim() !== "")
		.slice(-STREAMING_TAIL_LINES);
	if (tail.length === 0) return nothing();
	return new Text(tail.map((line) => theme.fg("dim", line)).join("\n"), 2, 0);
}

function boxed(component: Component): Component {
	const box = new Box(1, 0);
	box.addChild(component);
	return box;
}

function seatOf(run: RunRole, runs: CallRuns, context: RenderContext): RunSeat {
	const memory = rowMemory(context);
	memory.seat ??= run === "interrupts" ? runs.interrupt() : runs.join(() => memory.expanded === true);
	return memory.seat;
}

function takeSeat(run: RunRole, seat: RunSeat, outcome: RowOutcome): void {
	if (outcome.kind === "failed") seat.stepApart();
	else if (run !== "interrupts") seat.fold(run);
}

function settledOf<Call>(call: Call, result: RenderedResult, context: RenderContext): Settled<Call> {
	const details = toolDetails(result.details);
	const patch = reportedPatch(details);
	return {
		call,
		output: toolOutput(result.content),
		details,
		diff: patch === undefined ? undefined : editDiff(patch),
		elapsedMs: elapsedOf(rowMemory(context)),
	};
}

function viewRenderers<Call>(tool: BuiltInTool, spec: ViewSpec<Call>): ToolView {
	return (pi, runs, showsZen, now) => {
		return selfShell(
			(args, theme, context) => {
				if (!showsZen()) return piCall(pi, args, theme, context) ?? nothing();

				const memory = rowMemory(context);
				memory.expanded = context.expanded;
				startClock(context, now);
				seatOf(spec.run, runs, context);
				const input = toolInput(args);

				if (context.isPartial) {
					const row: ToolRow = { ...headingOf(tool, input, context.cwd), outcome: RUNNING };
					return rowComponent(row, undefined, OWN_SEAT.line, theme);
				}
				if (!context.expanded) return nothing();
				return piCall(pi, args, theme, context) ?? nothing();
			},
			(result, options, theme, context) => {
				if (!showsZen()) return piResult(pi, result, options, theme, context) ?? nothing();
				if (options.isPartial) return context.expanded ? streamingTail(toolOutput(result.content), theme) : nothing();

				const memory = rowMemory(context);
				memory.expanded = context.expanded;
				settleClock(memory, now);
				const seat = seatOf(spec.run, runs, context);
				const input = toolInput(context.args);
				const shown = settledOf(spec.call(input), result, context);
				const outcome: RowOutcome = context.isError
					? { kind: "failed", reason: spec.failure(shown.output) }
					: settled(spec.detail(shown));
				takeSeat(spec.run, seat, outcome);
				const row: ToolRow = { ...headingOf(tool, input, context.cwd), outcome };

				if (context.expanded) {
					const own = piResult(pi, result, options, theme, context);
					return own === undefined ? nothing() : boxed(own);
				}
				return rowComponent(row, outcome.kind === "failed" ? undefined : shown.diff, seat.line, theme);
			},
		);
	};
}

function counted(summary: string, details: ToolDetails): RowDetail {
	if (reachedLimit(details)) return attention(`${summary} · limit`);
	if (isTruncated(details)) return attention(`${summary} · truncated`);
	return quiet(summary);
}

function withTruncation(parts: readonly string[], details: ToolDetails): RowDetail | undefined {
	if (isTruncated(details)) return attention([...parts, "truncated"].join(" · "));
	return parts.length === 0 ? undefined : quiet(parts.join(" · "));
}

function ignoredInput(): undefined {
	return undefined;
}

function firstLineOf(output: ToolOutput): string | undefined {
	return firstActionableLine(output.body);
}

const READ: ViewSpec<ReadSpan> = {
	run: "read",
	call: readSpan,
	detail: ({ call, output, details }) => {
		if (output.image) return quiet("image");
		return withTruncation(call.offset === undefined ? [] : [`from ${call.offset}`], details);
	},
	failure: firstLineOf,
};

const RUN: ViewSpec<undefined> = {
	run: "run",
	call: ignoredInput,
	detail: ({ details, elapsedMs }) => withTruncation(elapsedMs === undefined ? [] : [formatDuration(elapsedMs)], details),
	failure: (output) => bashFailureSummary(output.body),
};

const EDIT: ViewSpec<undefined> = {
	run: "interrupts",
	call: ignoredInput,
	detail: ({ diff }) => {
		const summary = diff === undefined ? undefined : editSummary(diff);
		return summary === undefined ? undefined : quiet(summary);
	},
	failure: firstLineOf,
};

const WRITE: ViewSpec<WrittenFile> = {
	run: "interrupts",
	call: writtenFile,
	detail: ({ call }) => quiet(plural(countFileLines(call.content), "line", "lines")),
	failure: firstLineOf,
};

const GREP: ViewSpec<undefined> = {
	run: "grep",
	call: ignoredInput,
	detail: ({ output, details }) => counted(plural(countMatches(output.body), "match", "matches"), details),
	failure: firstLineOf,
};

const FIND: ViewSpec<undefined> = {
	run: "find",
	call: ignoredInput,
	detail: ({ output, details }) => counted(plural(countListed(output.body), "file", "files"), details),
	failure: firstLineOf,
};

const LIST: ViewSpec<undefined> = {
	run: "list",
	call: ignoredInput,
	detail: ({ output, details }) => counted(plural(countListed(output.body), "entry", "entries"), details),
	failure: firstLineOf,
};

const TOOL_VIEWS = {
	read: viewRenderers("read", READ),
	bash: viewRenderers("bash", RUN),
	powershell: viewRenderers("powershell", RUN),
	edit: viewRenderers("edit", EDIT),
	write: viewRenderers("write", WRITE),
	grep: viewRenderers("grep", GREP),
	find: viewRenderers("find", FIND),
	ls: viewRenderers("ls", LIST),
} satisfies { readonly [Tool in BuiltInTool]: ToolView };

export function registerToolViews(
	pi: Pick<ExtensionAPI, "registerToolRenderer">,
	runs: CallRuns,
	showsZen: () => boolean,
	now: Clock,
): void {
	pi.registerToolRenderer((toolName, next) => {
		if (!showsZen()) return next();
		const tool = builtInTool(toolName);
		return tool === undefined ? next() : TOOL_VIEWS[tool](next(), runs, showsZen, now);
	});
}
