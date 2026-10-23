import {
	type ExtensionAPI,
	getLanguageFromPath,
	type Theme,
	type ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, Container, Text } from "@earendil-works/pi-tui";

import { quietLiveTheme, renderPalette } from "./backgroundless-theme.ts";
import { type CallRuns, groupedRenderers } from "./call-group.ts";
import { codemodeFailures, codemodeRenderers } from "./codemode-view.ts";
import { diffLayout, type EditDiff, editDiff, editSummary } from "./edit-diff.ts";
import { mcpRenderers } from "./mcp-view.ts";
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
import { type PreviewBody, rowPreview } from "./row-preview.ts";
import { sourceLayout } from "./source-view.ts";
import {
	builtInTool,
	type BuiltInTool,
	CODEMODE,
	headingOf,
	mcpToolName,
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
	shortOutputLine,
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
import { isFiniteNumber, isString } from "./value-guards.ts";
import { widthCached } from "./width-cache.ts";

const STREAMING_TAIL_LINES = 10;
const MORE_LINES = /^(\d+) more lines in file\b/;
const MARKDOWN_PATH = /\.(?:md|markdown)$/i;

type Settled<Call> = {
	readonly call: Call;
	readonly output: ToolOutput;
	readonly details: ToolDetails;
	readonly diff: EditDiff | undefined;
	readonly elapsedMs: number | undefined;
};

type CachedResult<Call> = {
	readonly args: unknown;
	readonly content: RenderedResult["content"];
	readonly details: unknown;
	readonly error: boolean;
	readonly images: boolean;
	readonly cwd: string;
	readonly shown: Settled<Call>;
	palette: string;
	compact: Component | undefined;
	expanded: Component | undefined;
};

type PreviewTarget = {
	readonly kind: PreviewBody["kind"];
	readonly path: string;
};

type PreviewText = {
	readonly text: string;
	readonly startLine: number;
};

type Preview<Call> = {
	readonly target: (call: Call) => PreviewTarget | undefined;
	readonly text: (settled: Settled<Call>) => PreviewText | undefined;
};

type ViewSpec<Call> = {
	readonly call: (input: ToolInput) => Call;
	readonly detail: (settled: Settled<Call>) => RowDetail | undefined;
	readonly failure: (output: ToolOutput) => string | undefined;
	readonly preview: Preview<Call> | undefined;
};

type ToolView = (pi: ToolRenderers | undefined, showsZen: () => boolean, now: Clock) => ToolRenderers;

function rowComponent(row: ToolRow, diff: Component | undefined, palette: RowPalette): Component {
	return widthCached((width) => {
		const head = formatToolRow(row, width, palette);
		return diff === undefined ? [head] : [head, ...diff.render(width)];
	}, diff === undefined ? [] : [diff]);
}

function streamingTail(output: ToolOutput, theme: Theme): Component {
	const tail = output.body
		.split("\n")
		.filter((line) => line.trim() !== "")
		.slice(-STREAMING_TAIL_LINES);
	if (tail.length === 0) return nothing();
	return new Text(tail.map((line) => theme.fg("dim", line)).join("\n"), 2, 0);
}

function stacked(top: Component, bottom: Component): Component {
	const stack = new Container();
	stack.addChild(top);
	stack.addChild(bottom);
	return stack;
}

function boxed(component: Component): Component {
	const box = new Box(1, 0);
	box.addChild(component);
	return box;
}

function settledOf<Call>(call: Call, result: RenderedResult, context: RenderContext): Settled<Call> {
	const details = toolDetails(result.details);
	const patch = reportedPatch(details);
	return {
		call,
		output: toolOutput(result.content),
		details,
		diff: patch === undefined ? undefined : editDiff(patch),
		elapsedMs: elapsedOf(context),
	};
}

function outputBody(output: ToolOutput, theme: Theme): Component {
	const body = output.body === "" ? nothing() : new Text(theme.fg("toolOutput", output.body), 2, 0);
	return output.notice === undefined ? body : stacked(body, new Text(theme.fg("warning", output.notice), 2, 0));
}

function viewRenderers<Call>(tool: BuiltInTool, spec: ViewSpec<Call>): ToolView {
	return (pi, showsZen, now) => {
		const results = new WeakMap<object, CachedResult<Call>>();
		const expandedResult = (
			row: ToolRow,
			shown: Settled<Call>,
			piView: () => Component | undefined,
			theme: Theme,
			input: ToolInput,
		): Component => {
			if (tool === "edit" && row.outcome.kind !== "failed" && shown.diff !== undefined) {
				return rowComponent(row, diffLayout(shown.diff, readSpan(input).path, theme), theme);
			}
			const head = rowComponent(row, undefined, theme);
			if (tool === "bash" || tool === "powershell") {
				const command = isString(input.command) ? input.command : "";
				const source = sourceLayout({ path: tool === "bash" ? "command.sh" : "command.ps1", text: command, startLine: 1 }, theme);
				const metadata = isFiniteNumber(input.timeout) && input.timeout > 0
					? stacked(head, new Text(theme.fg("dim", `timeout ${input.timeout}s`), 2, 0))
					: head;
				return stacked(stacked(metadata, source), outputBody(shown.output, theme));
			}
			if (row.outcome.kind === "failed") return stacked(head, outputBody(shown.output, theme));
			const preview = spec.preview;
			const target = preview?.target(shown.call);
			const text = target === undefined ? undefined : preview?.text(shown);
			if (target !== undefined && text !== undefined) return rowPreview(row, previewBody(target, text), theme);

			const own = piView();
			const framed = own === undefined ? nothing() : boxed(own);
			if (target === undefined && tool !== "edit") return framed;
			return stacked(rowComponent(row, undefined, theme), framed);
		};

		return selfShell(
			(args, theme, context) => {
				if (!showsZen()) return piCall(pi, args, theme, context) ?? nothing();

				const memory = rowMemory(context);
				memory.expanded = context.expanded;
				startClock(context, now);
				const input = toolInput(args);

				if (context.isPartial) {
					const row: ToolRow = { ...headingOf(tool, input, context.cwd), outcome: RUNNING };
					return rowComponent(row, undefined, theme);
				}
				if (!context.expanded || context.isError || tool === "bash" || tool === "powershell") return nothing();
				if (tool === "edit" || spec.preview?.target(spec.call(input)) !== undefined) return nothing();
				return piCall(pi, args, theme, context) ?? nothing();
			},
			(result, options, theme, context) => {
				if (!showsZen()) return piResult(pi, result, options, theme, context) ?? nothing();
				// Pi rebuilds tools before Zen's render-time theme follower can quiet a new palette.
				quietLiveTheme();
				if (options.isPartial) return context.expanded ? streamingTail(toolOutput(result.content), theme) : nothing();

				const memory = rowMemory(context);
				memory.expanded = context.expanded;
				settleClock(memory, now);
				const input = toolInput(context.args);
				const palette = renderPalette(theme);
				let cached = results.get(memory);
				if (cached === undefined || cached.args !== context.args || cached.content !== result.content || cached.details !== result.details || cached.error !== context.isError || cached.images !== context.showImages || cached.cwd !== context.cwd) {
					cached = {
						args: context.args,
						content: result.content,
						details: result.details,
						error: context.isError,
						images: context.showImages,
						cwd: context.cwd,
						shown: settledOf(spec.call(input), result, context),
						palette,
						compact: undefined,
						expanded: undefined,
					};
					results.set(memory, cached);
				}
				if (cached.palette !== palette) {
					cached.palette = palette;
					// Pi invalidates only the mounted view; discard inactive ANSI-bearing views too.
					cached.compact = undefined;
					cached.expanded = undefined;
				}
				const shown = cached.shown;
				const outcome: RowOutcome = context.isError
					? { kind: "failed", reason: spec.failure(shown.output) }
					: settled(spec.detail(shown));
				const row: ToolRow = { ...headingOf(tool, input, context.cwd), outcome };

				if (context.expanded) {
					cached.expanded ??= expandedResult(row, shown, () => piResult(pi, result, options, theme, context), theme, input);
					return cached.expanded;
				}
				cached.compact ??= rowComponent(row, undefined, theme);
				return cached.compact;
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

function previewTarget(path: string): PreviewTarget | undefined {
	if (MARKDOWN_PATH.test(path)) return { kind: "markdown", path };
	return getLanguageFromPath(path) === undefined ? undefined : { kind: "source", path };
}

function readsWholeFile(span: ReadSpan): boolean {
	return (span.offset === undefined || span.offset === 1) && span.limit === undefined;
}

function readPreviewTarget(span: ReadSpan): PreviewTarget | undefined {
	if (span.path === undefined) return undefined;
	const target = previewTarget(span.path);
	return target?.kind === "markdown" && !readsWholeFile(span) ? undefined : target;
}

function previewBody(target: PreviewTarget, { text, startLine }: PreviewText): PreviewBody {
	return target.kind === "markdown"
		? { kind: "markdown", text }
		: { kind: "source", file: { path: target.path, text, startLine } };
}

function ignoredInput(): undefined {
	return undefined;
}

function firstLineOf(output: ToolOutput): string | undefined {
	return firstActionableLine(output.body);
}

const READ: ViewSpec<ReadSpan> = {
	call: readSpan,
	detail: ({ call, output, details }) => {
		if (output.image) return quiet("image");
		const more = output.notice === undefined ? undefined : MORE_LINES.exec(output.notice)?.[1];
		const parts = [
			...(call.offset === undefined ? [] : [`from ${call.offset}`]),
			...(more === undefined ? [] : [`${more} more`]),
		];
		return withTruncation(parts, details);
	},
	failure: firstLineOf,
	preview: {
		target: readPreviewTarget,
		text: ({ call, output, details }) =>
			output.image || isTruncated(details) ? undefined : { text: output.body, startLine: call.offset ?? 1 },
	},
};

const RUN: ViewSpec<undefined> = {
	call: ignoredInput,
	detail: ({ output, details, elapsedMs }) => {
		const answer = shortOutputLine(output);
		const parts = [
			...(answer === undefined ? [] : [answer]),
			...(elapsedMs === undefined ? [] : [formatDuration(elapsedMs)]),
		];
		return withTruncation(parts, details);
	},
	failure: (output) => bashFailureSummary(output.body),
	preview: undefined,
};

const EDIT: ViewSpec<undefined> = {
	call: ignoredInput,
	detail: ({ diff }) => {
		const summary = diff === undefined ? undefined : editSummary(diff);
		return summary === undefined ? undefined : quiet(summary);
	},
	failure: firstLineOf,
	preview: undefined,
};

const WRITE: ViewSpec<WrittenFile> = {
	call: writtenFile,
	detail: ({ call }) => quiet(plural(countFileLines(call.content), "line", "lines")),
	failure: firstLineOf,
	preview: {
		target: (call) => (call.path === undefined ? undefined : previewTarget(call.path)),
		text: ({ call }) => ({ text: call.content, startLine: 1 }),
	},
};

const GREP: ViewSpec<undefined> = {
	call: ignoredInput,
	detail: ({ output, details }) => counted(plural(countMatches(output.body), "match", "matches"), details),
	failure: firstLineOf,
	preview: undefined,
};

const FIND: ViewSpec<undefined> = {
	call: ignoredInput,
	detail: ({ output, details }) => counted(plural(countListed(output.body), "file", "files"), details),
	failure: firstLineOf,
	preview: undefined,
};

const LIST: ViewSpec<undefined> = {
	call: ignoredInput,
	detail: ({ output, details }) => counted(plural(countListed(output.body), "entry", "entries"), details),
	failure: firstLineOf,
	preview: undefined,
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
		if (toolName === CODEMODE) return groupedRenderers(toolName, codemodeRenderers(next(), showsZen, now), runs, showsZen, codemodeFailures);
		const mcp = mcpToolName(toolName);
		if (mcp !== undefined) return groupedRenderers(toolName, mcpRenderers(mcp, next(), showsZen, now), runs, showsZen);
		const tool = builtInTool(toolName);
		if (tool === undefined) {
			runs.close();
			return next();
		}
		return groupedRenderers(toolName, TOOL_VIEWS[tool](next(), showsZen, now), runs, showsZen);
	});
}
