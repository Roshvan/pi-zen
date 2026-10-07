import type {
	BashToolInput,
	EditToolInput,
	FindToolInput,
	GrepToolInput,
	LsToolInput,
	ReadToolInput,
	WriteToolInput,
} from "@earendil-works/pi-coding-agent";

import { displayPath } from "./display-path.ts";
import type { RowSubject } from "./tool-row.ts";
import { isFiniteNumber, isString, parseRecord, type Reported } from "./value-guards.ts";

export type ToolInput = Reported<
	ReadToolInput & BashToolInput & EditToolInput & WriteToolInput & GrepToolInput & FindToolInput & LsToolInput
>;

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

function positiveInteger(value: number | null | undefined): number | undefined {
	return isFiniteNumber(value) && Number.isInteger(value) && value > 0 ? value : undefined;
}

function firstLine(text: string): string {
	return text.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
}

function commandHead(command: string): string {
	const lines = command.split("\n").filter((line) => line.trim() !== "");
	const head = lines.at(0)?.trim() ?? "";
	return lines.length > 1 ? `${head} …` : head;
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

const BUILT_INS = {
	read: { verb: "read", subject: pathSubject },
	edit: { verb: "edit", subject: pathSubject },
	write: { verb: "write", subject: pathSubject },
	bash: { verb: "run", subject: commandSubject },
	powershell: { verb: "run", subject: commandSubject },
	grep: { verb: "grep", subject: patternSubject },
	find: { verb: "find", subject: patternSubject },
	ls: { verb: "list", subject: listSubject },
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
