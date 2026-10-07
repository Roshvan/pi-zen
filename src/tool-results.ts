import type {
	BashToolDetails,
	EditToolDetails,
	FindToolDetails,
	GrepToolDetails,
	LsToolDetails,
	ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

import { isString, parseRecord, type Reported } from "./value-guards.ts";

export type ToolDetails = Reported<
	ReadToolDetails & BashToolDetails & EditToolDetails & GrepToolDetails & FindToolDetails & LsToolDetails
>;

type ContentBlock = {
	readonly type: string;
	readonly text?: string;
};

export type ToolOutput = {
	readonly body: string;
	readonly notice: string | undefined;
	readonly image: boolean;
};

const TAB = 0x09;
const NEWLINE = 0x0a;
const FIRST_PRINTABLE = 0x20;
const SPECIALS = { first: 0xfff9, last: 0xfffb };
const TRAILING_NOTICE = /\n\n\[([^\n]*)\]$/;
const MATCH_LINE = /:\d+:/;
const NOTHING_FOUND: ReadonlySet<string> = new Set(["No files found matching pattern", "(empty directory)", "No matches found"]);
const ERRNO_PATH_CLAUSE =
	/,\s*(?:access|open|stat|lstat|scandir|read|write|unlink|mkdir|rmdir|copyfile|rename)\s+'[^']*'\s*$/;
const BASH_STATUS = /^Command (?:exited with code (\d+)|aborted|timed out after (\S+) seconds)$/;

function isUnprintable(char: string): boolean {
	const code = char.codePointAt(0) ?? 0;
	return (code < FIRST_PRINTABLE && code !== TAB && code !== NEWLINE) || (code >= SPECIALS.first && code <= SPECIALS.last);
}

function printable(text: string): string {
	const stripped = stripTerminalSequences(text);
	const chars = Array.from(stripped);
	return chars.some(isUnprintable) ? chars.filter((char) => !isUnprintable(char)).join("") : stripped;
}

export function toolOutput(content: readonly ContentBlock[]): ToolOutput {
	const text = content
		.filter((block) => block.type === "text")
		.map((block) => printable(block.text ?? ""))
		.join("\n");
	const notice = TRAILING_NOTICE.exec(text);
	return {
		body: notice === null ? text : text.slice(0, notice.index),
		notice: notice?.[1],
		image: content.some((block) => block.type === "image"),
	};
}

const NO_DETAILS: ToolDetails = {};

export function toolDetails<Value>(value: Value): ToolDetails {
	return parseRecord(value, NO_DETAILS);
}

export function isTruncated(details: ToolDetails): boolean {
	return details.truncation?.truncated === true;
}

export function reachedLimit(details: ToolDetails): boolean {
	return [details.matchLimitReached, details.resultLimitReached, details.entryLimitReached].some(
		(limit) => limit !== undefined && limit !== null,
	);
}

export function reportedPatch(details: ToolDetails): string | undefined {
	const patch = details.patch;
	return isString(patch) && patch !== "" ? patch : undefined;
}

function listedLines(body: string): readonly string[] {
	const lines = body.split("\n").filter((line) => line.trim() !== "");
	return lines.length === 1 && NOTHING_FOUND.has(lines[0]?.trim() ?? "") ? [] : lines;
}

export function countListed(body: string): number {
	return listedLines(body).length;
}

export function countMatches(body: string): number {
	return listedLines(body).filter((line) => MATCH_LINE.test(line)).length;
}

export function countFileLines(text: string): number {
	if (text === "") return 0;
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

export function firstActionableLine(output: string): string | undefined {
	const first = output
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line !== "");
	return first?.replace(ERRNO_PATH_CLAUSE, "");
}

function statusLabel(status: RegExpExecArray): string {
	const [, code, timeout] = status;
	if (code !== undefined) return `exit ${code}`;
	return timeout === undefined ? "aborted" : `timeout ${timeout}s`;
}

export function bashFailureSummary(output: string): string | undefined {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const first = lines.at(0);
	const last = lines.at(-1);
	const status = last === undefined ? null : BASH_STATUS.exec(last);
	if (status === null) return first;
	const label = statusLabel(status);
	return first === undefined || first === last || first === "(no output)" ? label : `${label} · ${first}`;
}
