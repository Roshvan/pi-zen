import type {
	CodemodeToolDetails,
	Theme,
	ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";

import { fieldsOf, parseCodemodeScript, type ScriptCall } from "./codemode-script.ts";
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
import { sourceLayout } from "./source-view.ts";
import {
	builtInTool,
	type CallHeading,
	headingLabel,
	headingOf,
	labelToolCall,
	scriptSource,
	type ToolInput,
	toolInput,
} from "./tool-calls.ts";
import { firstActionableLine, toolOutput } from "./tool-results.ts";
import {
	formatDuration,
	formatToolRow,
	plural,
	quiet,
	type RowOutcome,
	RUNNING,
	settled,
	type ToolRow,
} from "./tool-row.ts";
import { isFiniteNumber, isString, parseRecord, type Reported } from "./value-guards.ts";
import { widthCached } from "./width-cache.ts";

type NestedCall = CodemodeToolDetails["calls"][number];

type ReportedCall = Reported<NestedCall>;

type ReportedDetails = {
	readonly calls?: readonly (ReportedCall | null | undefined)[] | null | undefined;
};

type NestedStatus = NestedCall["status"];

type Step = {
	readonly heading: CallHeading;
	readonly outcome: RowOutcome;
};

type Progress =
	| { readonly kind: "writing" }
	| { readonly kind: "running"; readonly result: RenderedResult }
	| { readonly kind: "succeeded"; readonly result: RenderedResult; readonly elapsedMs: number | undefined }
	| { readonly kind: "failed"; readonly result: RenderedResult };

type Answer =
	| { readonly kind: "echo"; readonly line: string }
	| { readonly kind: "summary"; readonly text: string | undefined };

type ScriptRun = {
	readonly row: ToolRow;
	readonly steps: readonly Step[];
	readonly output: readonly string[];
	readonly source: string | undefined;
};

type ShownResult = {
	readonly outcome: RowOutcome;
	readonly output: readonly string[];
};

type Layout = "row" | "detailed" | "steps";

const HEADER = /^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/;
const SCRIPT_ERROR = "Script error:";
const ERROR_PREFIX = /^Error:\s*/;
const SHORT_ANSWER = 48;
const OUTPUT_LINES = 8;
const INDENT = "  ";
const ELLIPSIS = "…";
const NO_DETAILS: ReportedDetails = {};
const STATUSES: ReadonlySet<string> = new Set(["running", "ok", "error", "cancelled"] satisfies NestedStatus[]);

export function codemodeRenderers(pi: ToolRenderers | undefined, showsZen: () => boolean, now: Clock): ToolRenderers {
	return selfShell(
		(args, theme, context) => {
			if (!showsZen()) return piCall(pi, args, theme, context) ?? nothing();
			startClock(context, now);
			if (!context.isPartial) return nothing();
			return scriptView(scriptRun(scriptSource(toolInput(args)), { kind: "writing" }, context.cwd), "row", theme);
		},
		(result, options, theme, context) => {
			if (!showsZen()) return piResult(pi, result, options, theme, context) ?? nothing();
			const code = scriptSource(toolInput(context.args));
			if (options.isPartial) {
				if (!context.expanded) return nothing();
				return scriptView(scriptRun(code, { kind: "running", result }, context.cwd), "steps", theme);
			}
			const memory = rowMemory(context);
			settleClock(memory, now);
			const progress: Progress = context.isError
				? { kind: "failed", result }
				: { kind: "succeeded", result, elapsedMs: elapsedOf(memory) };
			return scriptView(scriptRun(code, progress, context.cwd), layoutFor(context), theme);
		},
	);
}

function layoutFor(context: RenderContext): Layout {
	return context.expanded ? "detailed" : "row";
}

function stepLine(step: Step, width: number, theme: Theme): string {
	return formatToolRow({ ...step.heading, outcome: step.outcome }, width, theme);
}

function scriptLines(run: ScriptRun, layout: Layout, source: Component | undefined, theme: Theme, width: number): string[] {
	const head = layout === "steps" ? [] : [formatToolRow(run.row, width, theme)];
	const room = width - INDENT.length;
	if (layout === "row" || room <= 0) return head;

	const code = source?.render(width) ?? [];
	return [
		...head,
		...run.steps.map((step) => INDENT + stepLine(step, room, theme)),
		...(code.length > 0 ? ["", ...code] : []),
		...run.output.map((line) => INDENT + theme.fg("dim", truncateToWidth(line, room, ELLIPSIS))),
	];
}

function scriptView(run: ScriptRun, layout: Layout, theme: Theme): Component {
	const source =
		layout !== "row" && run.source !== undefined
			? sourceLayout({ path: "script.js", text: run.source, startLine: 1 }, theme)
			: undefined;
	return widthCached((width) => scriptLines(run, layout, source, theme, width), source === undefined ? [] : [source]);
}

function scriptRun(code: string, progress: Progress, cwd: string): ScriptRun {
	const script = parseCodemodeScript(code);
	const result = progress.kind === "writing" ? undefined : progress.result;
	const records = result === undefined ? [] : reportedCalls(result.details);
	const steps =
		records.length > 0
			? records.map((record) => recordStep(record, cwd))
			: script.calls.map((call) => scriptStep(call, cwd));
	const output = result === undefined ? [] : outputLines(toolOutput(result.content).body);
	const shown = shownResult(progress, output, steps.length);
	return {
		row: {
			verb: "code",
			subject: { text: script.note ?? stepsSubject(steps), elide: "end" },
			outcome: shown.outcome,
		},
		steps,
		output: shown.output,
		source: steps.length === 0 && code.trim() !== "" ? code : undefined,
	};
}

function shownResult(progress: Progress, output: readonly string[], callCount: number): ShownResult {
	switch (progress.kind) {
		case "writing":
		case "running":
			return { outcome: RUNNING, output: clippedOutput(output) };
		case "failed":
			return { outcome: { kind: "failed", reason: scriptFailure(output) }, output: clippedOutput(output) };
		case "succeeded": {
			const answer = answerOf(output, callCount, progress.elapsedMs);
			if (answer.kind === "echo") return { outcome: settled(quiet(answer.line)), output: [] };
			return {
				outcome: settled(answer.text === undefined ? undefined : quiet(answer.text)),
				output: clippedOutput(output),
			};
		}
	}
}

function isPresent(call: ReportedCall | null | undefined): call is ReportedCall {
	return call !== null && call !== undefined;
}

function reportedCalls<Value>(details: Value): readonly ReportedCall[] {
	const calls = parseRecord(details, NO_DETAILS).calls;
	return Array.isArray(calls) ? calls.filter(isPresent) : [];
}

function isKnownStatus(status: string | null | undefined): status is NestedStatus {
	return isString(status) && STATUSES.has(status);
}

function jsonInput(text: string): ToolInput {
	try {
		return toolInput(JSON.parse(text));
	} catch {
		return fieldsOf(text);
	}
}

function stepHeading(name: string, input: ToolInput, cwd: string): CallHeading {
	const tool = builtInTool(name);
	if (tool !== undefined) return headingOf(tool, input, cwd);
	return { verb: "call", subject: { text: labelToolCall(name, input, cwd), elide: "end" } };
}

function recordStep(record: ReportedCall, cwd: string): Step {
	const name = isString(record.name) && record.name !== "" ? record.name : "call";
	const input = isString(record.args) ? jsonInput(record.args) : toolInput(record.args);
	return { heading: stepHeading(name, input, cwd), outcome: recordOutcome(record) };
}

function scriptStep(call: ScriptCall, cwd: string): Step {
	return { heading: stepHeading(call.name, call.input, cwd), outcome: RUNNING };
}

function recordOutcome(record: ReportedCall): RowOutcome {
	const status = isKnownStatus(record.status) ? record.status : "ok";
	switch (status) {
		case "error":
			return { kind: "failed", reason: isString(record.error) ? firstActionableLine(record.error) : undefined };
		case "cancelled":
			return { kind: "failed", reason: "cancelled" };
		case "running":
			return RUNNING;
		case "ok":
			return settled(isFiniteNumber(record.durationMs) ? quiet(formatDuration(record.durationMs)) : undefined);
	}
}

function stepsSubject(steps: readonly Step[]): string {
	const first = steps[0];
	if (first === undefined) return "a script";
	return headingLabel(first.heading);
}

function outputLines(text: string): readonly string[] {
	return text
		.replace(HEADER, "")
		.split("\n")
		.filter((line) => line.trim() !== "");
}

function scriptFailure(output: readonly string[]): string | undefined {
	const at = output.findIndex((line) => line.trim() === SCRIPT_ERROR);
	return firstActionableLine((at === -1 ? output : output.slice(at + 1)).join("\n"))?.replace(ERROR_PREFIX, "");
}

function answerOf(output: readonly string[], callCount: number, elapsedMs: number | undefined): Answer {
	const only = output.length === 1 ? output[0]?.trim() : undefined;
	if (only !== undefined && only.length <= SHORT_ANSWER) return { kind: "echo", line: only };

	const duration = elapsedMs === undefined ? undefined : formatDuration(elapsedMs);
	if (callCount > 0) {
		const calls = plural(callCount, "call", "calls");
		return { kind: "summary", text: duration === undefined ? calls : `${calls} · ${duration}` };
	}
	return { kind: "summary", text: output.length > 1 ? `${output.length} lines` : duration };
}

function clippedOutput(output: readonly string[]): readonly string[] {
	return output.length > OUTPUT_LINES ? [...output.slice(0, OUTPUT_LINES), ELLIPSIS] : output;
}
