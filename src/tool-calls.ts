import type {
	BashToolInput,
	EditToolInput,
	FindToolInput,
	GrepToolInput,
	LsToolInput,
	ReadToolInput,
	WriteToolInput,
} from "@earendil-works/pi-coding-agent";

import { truncateToWidth } from "@earendil-works/pi-tui";

import { scriptNote } from "./codemode-script.ts";
import { displayPath } from "./display-path.ts";
import type { RowSubject } from "./tool-row.ts";
import { isFiniteNumber, isString, parseRecord, type Reported } from "./value-guards.ts";

type CodemodeInput = { readonly code: string };

export type ToolInput = Reported<
	ReadToolInput & BashToolInput & EditToolInput & WriteToolInput & GrepToolInput & FindToolInput & LsToolInput & CodemodeInput
>;

export const CODEMODE = "codemode";

export function mcpToolName(name: string): string | undefined {
	if (name === "list_mcp_resources" || name === "list_mcp_resource_templates" || name === "read_mcp_resource") return name;
	const match = /^mcp__([\w-]+?)__(.+)$/.exec(name);
	const server = match?.[1];
	const tool = match?.[2];
	return server === undefined || tool === undefined ? undefined : `${server}/${tool}`;
}

export function displayToolName(name: string): string {
	return mcpToolName(name) ?? name;
}

export function hasZenToolView(name: string): boolean {
	return name === CODEMODE || builtInTool(name) !== undefined || mcpToolName(name) !== undefined;
}

export type BuiltInTool = "read" | "edit" | "write" | "bash" | "powershell" | "grep" | "find" | "ls";

export type CallHeading = {
	readonly verb: string;
	readonly subject: RowSubject | undefined;
};

export type ReadSpan = {
	readonly path: string | undefined;
	readonly offset: number | undefined;
	readonly limit: number | undefined;
};

export type WrittenFile = {
	readonly path: string | undefined;
	readonly content: string;
};

type Subject = (input: ToolInput, cwd: string) => RowSubject | undefined;

type BuiltIn = {
	readonly verb: string;
	readonly subject: Subject;
};

const NO_INPUT: ToolInput = {};

export function toolInput<Value>(value: Value): ToolInput {
	return parseRecord(value, NO_INPUT);
}

function presentText(value: string | null | undefined): string | undefined {
	return isString(value) && value.trim() !== "" ? value : undefined;
}

function positiveInteger(value: number | string | null | undefined): number | undefined {
	const parsed = isString(value) && value.trim() !== "" ? Number(value) : value;
	return isFiniteNumber(parsed) && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function firstLine(text: string): string {
	return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

function commandHead(command: string): string {
	const lines = command.split("\n").filter((line) => line.trim() !== "");
	const head = lines.at(0)?.trim() ?? "";
	if (lines.length > 1) return "shell script";
	return head.length > 64 || /[;&|<>`$(){}]/.test(head) ? "shell command" : head;
}

const pathSubject: Subject = (input, cwd) => {
	const path = presentText(input.path);
	return path === undefined ? undefined : { text: displayPath(firstLine(path), cwd), elide: "path" };
};

const listSubject: Subject = (input, cwd) => ({
	text: displayPath(firstLine(presentText(input.path) ?? "."), cwd),
	elide: "path",
});

const patternSubject: Subject = (input) => {
	const pattern = presentText(input.pattern);
	return pattern === undefined ? undefined : { text: firstLine(pattern), elide: "end" };
};

const commandSubject: Subject = (input) => {
	const command = presentText(input.command);
	return command === undefined ? undefined : { text: commandHead(command), elide: "end" };
};

const noteSubject: Subject = (input) => {
	const code = presentText(input.code);
	const note = code === undefined ? undefined : scriptNote(code);
	return note === undefined ? undefined : { text: note, elide: "end" };
};

const BUILT_INS = {
	read: { verb: "read", subject: pathSubject },
	edit: { verb: "edit", subject: pathSubject },
	write: { verb: "write", subject: pathSubject },
	bash: { verb: "bash", subject: commandSubject },
	powershell: { verb: "powershell", subject: commandSubject },
	grep: { verb: "grep", subject: patternSubject },
	find: { verb: "find", subject: patternSubject },
	ls: { verb: "ls", subject: listSubject },
} satisfies { readonly [Tool in BuiltInTool]: BuiltIn };

function isBuiltInTool(name: string): name is BuiltInTool {
	return Object.hasOwn(BUILT_INS, name);
}

export function builtInTool(name: string): BuiltInTool | undefined {
	return isBuiltInTool(name) ? name : undefined;
}

export function headingOf(tool: BuiltInTool, input: ToolInput, cwd: string): CallHeading {
	const builtIn = BUILT_INS[tool];
	return { verb: builtIn.verb, subject: builtIn.subject(input, cwd) };
}

function callHeading(name: string, input: ToolInput, cwd: string): CallHeading {
	const tool = builtInTool(name);
	if (tool !== undefined) return headingOf(tool, input, cwd);
	if (name === CODEMODE) return { verb: CODEMODE, subject: noteSubject(input, cwd) };
	const mcp = mcpToolName(name);
	if (mcp !== undefined) return { verb: "mcp", subject: { text: mcp, elide: "end" } };
	return {
		verb: name,
		subject: pathSubject(input, cwd) ?? patternSubject(input, cwd) ?? commandSubject(input, cwd),
	};
}

export function headingLabel(heading: CallHeading): string {
	return heading.subject === undefined ? heading.verb : `${heading.verb} ${heading.subject.text}`;
}

export function labelToolCall(name: string, input: ToolInput, cwd: string): string {
	return headingLabel(callHeading(name, input, cwd));
}

export function workLabel(name: string, input: ToolInput, cwd: string): string {
	const heading = callHeading(name, input, cwd);
	const command = name === "bash" || name === "powershell" ? presentText(input.command) : undefined;
	const subject = command === undefined ? heading.subject?.text : firstLine(command);
	const phrase = workVerb(name, input);
	const label = subject === undefined || name === CODEMODE || mcpToolName(name) !== undefined
		? phrase
		: `${phrase} ${subject}`;
	// Leave room for the indicator, elapsed time, and parallel count in an 80-column pane.
	return truncateToWidth(label, 52, "…");
}

function workVerb(name: string, input: ToolInput): string {
	if (name === CODEMODE) return scriptNote(scriptSource(input)) ?? "running a script";
	switch (builtInTool(name)) {
		case "read": return "reading";
		case "grep":
		case "find": return "searching";
		case "ls": return "listing files";
		case "edit": return "editing";
		case "write": return "writing";
		case "bash":
		case "powershell": return "running";
		case undefined: return displayToolName(name);
	}
}

export function readSpan(input: ToolInput): ReadSpan {
	return {
		path: presentText(input.path),
		offset: positiveInteger(input.offset),
		limit: positiveInteger(input.limit),
	};
}

export function writtenFile(input: ToolInput): WrittenFile {
	return { path: presentText(input.path), content: isString(input.content) ? input.content : "" };
}

export function scriptSource(input: ToolInput): string {
	return presentText(input.code) ?? "";
}
