import type { ToolInput } from "./tool-calls.ts";

export type ScriptCall = {
	readonly name: string;
	readonly input: ToolInput;
};

type ParsedScript = {
	readonly note: string | undefined;
	readonly calls: readonly ScriptCall[];
};

type Scanned = {
	readonly calls: readonly ScriptCall[];
	readonly end: number;
};

type FoundCall = {
	readonly call: ScriptCall;
	readonly end: number;
};

type Closing = "end of script" | "closing brace";

const OPTIONS = /^\/\/\s*@options\b/;
const CALL = String.raw`tools\.([A-Za-z_$][\w$]*)\s*\(\s*`;
const IDENTIFIER_CHAR = /[\w$]/;
const STRING_LITERAL = String.raw`("(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|` + "`" + String.raw`(?:\\.|[^` + "`" + String.raw`\\])*` + "`?)";
const FIELDS = {
	path: field("path"),
	pattern: field("pattern"),
	command: field("command"),
};

function field(key: string): RegExp {
	return new RegExp(String.raw`(?:^|[,{])\s*["']?` + key + String.raw`["']?\s*:\s*` + STRING_LITERAL);
}

export function parseCodemodeScript(code: string): ParsedScript {
	return { note: scriptNote(code), calls: scanCode(code, 0, "end of script").calls };
}

function scriptNote(code: string): string | undefined {
	const first = code
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line !== "" && !OPTIONS.test(line));
	if (first === undefined || !first.startsWith("//")) return undefined;
	const note = first.slice(2).trim();
	return note === "" ? undefined : note;
}

function scanCode(code: string, start: number, closing: Closing): Scanned {
	const calls: ScriptCall[] = [];
	let depth = 0;
	let index = start;
	while (index < code.length) {
		const char = code[index];
		if (code.startsWith("//", index)) index = lineEnd(code, index);
		else if (code.startsWith("/*", index)) index = commentEnd(code, index);
		else if (char === "'" || char === '"') index = quotedEnd(code, index);
		else if (char === "`") {
			const template = scanTemplate(code, index + 1);
			calls.push(...template.calls);
			index = template.end;
		} else if (char === "{") {
			depth += 1;
			index += 1;
		} else if (char === "}") {
			if (depth === 0 && closing === "closing brace") return { calls, end: index + 1 };
			depth = Math.max(0, depth - 1);
			index += 1;
		} else {
			const found = callAt(code, index);
			if (found === undefined) index += 1;
			else {
				calls.push(found.call);
				index = found.end;
			}
		}
	}
	return { calls, end: code.length };
}

function scanTemplate(code: string, start: number): Scanned {
	const calls: ScriptCall[] = [];
	let index = start;
	while (index < code.length) {
		if (code[index] === "\\") index += 2;
		else if (code[index] === "`") return { calls, end: index + 1 };
		else if (code.startsWith("${", index)) {
			const inner = scanCode(code, index + 2, "closing brace");
			calls.push(...inner.calls);
			index = inner.end;
		} else index += 1;
	}
	return { calls, end: code.length };
}

function lineEnd(code: string, index: number): number {
	const end = code.indexOf("\n", index);
	return end === -1 ? code.length : end;
}

function commentEnd(code: string, index: number): number {
	const end = code.indexOf("*/", index + 2);
	return end === -1 ? code.length : end + 2;
}

function quotedEnd(code: string, index: number): number {
	const quote = code[index];
	let cursor = index + 1;
	while (cursor < code.length && code[cursor] !== quote && code[cursor] !== "\n") {
		cursor += code[cursor] === "\\" ? 2 : 1;
	}
	return Math.min(code.length, cursor + 1);
}

function callAt(code: string, index: number): FoundCall | undefined {
	if (!code.startsWith("tools.", index)) return undefined;
	if (index > 0 && IDENTIFIER_CHAR.test(code[index - 1] ?? "")) return undefined;
	const call = new RegExp(CALL, "y");
	call.lastIndex = index;
	const match = call.exec(code);
	const name = match?.[1];
	if (match === null || name === undefined) return undefined;
	const argumentStart = index + match[0].length;
	const object = code[argumentStart] === "{" ? objectEnd(code, argumentStart) : undefined;
	if (object === undefined) return { call: { name, input: {} }, end: argumentStart };
	return { call: { name, input: fieldsOf(code.slice(argumentStart, object)) }, end: object };
}

function objectEnd(code: string, index: number): number | undefined {
	let depth = 0;
	let cursor = index;
	while (cursor < code.length) {
		const char = code[cursor];
		if (char === "'" || char === '"') cursor = quotedEnd(code, cursor);
		else if (char === "`") cursor = scanTemplate(code, cursor + 1).end;
		else {
			if (char === "{") depth += 1;
			if (char === "}") {
				depth -= 1;
				if (depth === 0) return cursor + 1;
			}
			cursor += 1;
		}
	}
	return undefined;
}

export function fieldsOf(source: string): ToolInput {
	return {
		path: stringField(source, FIELDS.path),
		pattern: stringField(source, FIELDS.pattern),
		command: stringField(source, FIELDS.command),
	};
}

function unquoted(literal: string): string {
	const quote = literal[0] ?? "";
	return literal.length > 1 && literal.endsWith(quote) ? literal.slice(1, -1) : literal.slice(1);
}

function stringField(source: string, pattern: RegExp): string | undefined {
	const literal = pattern.exec(source)?.[1];
	if (literal === undefined) return undefined;
	return unquoted(literal)
		.replace(/\\$/, "")
		.replace(/\\(.)/g, (_match, char: string) => (char === "n" ? "\n" : char));
}
