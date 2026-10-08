import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";

import { wrapInlineMarkdown } from "./inline-markdown-wrap.ts";

export type SentInk = {
	readonly words: string;
	readonly mark: string;
};

export const PLAIN_INK: SentInk = { words: "", mark: "" };

type MessageLook = {
	readonly ink: SentInk;
	readonly thinkingLines: number;
};

type Block =
	| { readonly kind: "prose"; readonly lines: readonly string[] }
	| { readonly kind: "code"; readonly lines: readonly [string, ...string[]] };

const THINKING_LINES = 8;
const SHORT_THINKING_LINES = 5;
const SHORT_TERMINAL_ROWS = 24;
const CUT_MARK = "…";

const SENT_PAD = "\u00A0";
const NARROWEST_FRAME = 8;
const FRAME_COLUMNS = 3;

const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})(.*)/;
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/;

export function thinkingLinesFor(terminalRows: number | undefined): number {
	return terminalRows !== undefined && terminalRows <= SHORT_TERMINAL_ROWS ? SHORT_THINKING_LINES : THINKING_LINES;
}

export function orientMessage(markdown: string, context: MarkdownTransformContext, look: MessageLook): string {
	if (markdown.trim() === "") return markdown;

	const blocks = fencedBlocks(markdown).map(squeezed);
	if (context.messageType === "user") return placeSent(blocks, context.availableWidth, look.ink);
	if (context.messageType === "assistant-thinking" && context.isStreaming) {
		return streamingTail(blocks, look.thinkingLines);
	}
	return joined(blocks);
}

function fencedBlocks(markdown: string): readonly Block[] {
	const blocks: Block[] = [];
	let prose: string[] = [];
	let code: { readonly fence: string; readonly lines: [string, ...string[]] } | undefined;

	for (const line of markdown.split("\n")) {
		if (code !== undefined) {
			code.lines.push(line);
			if (closesFence(line, code.fence)) {
				blocks.push({ kind: "code", lines: code.lines });
				code = undefined;
			}
			continue;
		}
		const fence = openedFence(line);
		if (fence === undefined) {
			prose.push(line);
			continue;
		}
		if (prose.length > 0) blocks.push({ kind: "prose", lines: prose });
		prose = [];
		code = { fence, lines: [line] };
	}

	if (code !== undefined) blocks.push({ kind: "code", lines: code.lines });
	if (prose.length > 0) blocks.push({ kind: "prose", lines: prose });
	return blocks;
}

function openedFence(line: string): string | undefined {
	const [, fence, info] = FENCE_OPENER.exec(line) ?? [];
	if (fence === undefined) return undefined;
	return fence.startsWith("`") && info?.includes("`") ? undefined : fence;
}

function closesFence(line: string, fence: string): boolean {
	const closer = FENCE_CLOSER.exec(line)?.[1];
	return closer !== undefined && closer[0] === fence[0] && closer.length >= fence.length;
}

function squeezed(block: Block): Block {
	if (block.kind === "code") return block;
	const lines = block.lines.filter((line, index) => !(isBlank(line) && block.lines[index - 1]?.trim() === ""));
	return { kind: "prose", lines };
}

function isBlank(line: string): boolean {
	return line.trim() === "";
}

function joined(blocks: readonly Block[]): string {
	return blocks.flatMap((block) => block.lines).join("\n");
}

function streamingTail(blocks: readonly Block[], budget: number): string {
	if (budget <= 0) return "";

	const lines = blocks.flatMap((block) => block.lines);
	if (lines.length <= budget) return lines.join("\n");

	const cut = lines.length - budget;
	return [CUT_MARK, ...fenceOpenAt(blocks, cut), ...lines.slice(cut)].join("\n");
}

function fenceOpenAt(blocks: readonly Block[], cut: number): readonly string[] {
	return blocks.reduce<{ readonly start: number; readonly opener: readonly string[] }>(
		(found, block) => {
			const end = found.start + block.lines.length;
			const cutInside = block.kind === "code" && found.start < cut && cut < end;
			return { start: end, opener: cutInside ? [block.lines[0]] : found.opener };
		},
		{ start: 0, opener: [] },
	).opener;
}

function placeSent(blocks: readonly Block[], width: number, ink: SentInk): string {
	if (width < NARROWEST_FRAME) return joined(blocks);

	const room = width - FRAME_COLUMNS;
	const body = blocks.flatMap((block) => placedBlock(block, room, ink)).join("\n\n");
	return `${ink.mark}╭${ink.words}\n${body}\n${ink.mark}╰${ink.words}`;
}

function placedBlock(block: Block, room: number, ink: SentInk): readonly string[] {
	if (block.kind === "code") return [block.lines.join("\n")];

	const first = block.lines.findIndex((line) => !isBlank(line));
	if (first < 0) return [];
	const last = block.lines.reduce((found, line, index) => (isBlank(line) ? found : index), first);
	return [frameSent(block.lines.slice(first, last + 1), room, ink)];
}

function frameSent(lines: readonly string[], room: number, ink: SentInk): string {
	const rows = lines.flatMap((line) => (isBlank(line) ? [""] : wrapInlineMarkdown(line, room)));

	return rows
		.map((row) => {
			if (isBlank(row)) return "";
			return `${SENT_PAD}${SENT_PAD}${ink.words}${row}`;
		})
		.join("\n");
}

