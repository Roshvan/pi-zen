import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { shortenPath } from "./display-path.ts";

export type RowPalette = {
	readonly fg: (color: ThemeColor, text: string) => string;
};

export type RowDetail = {
	readonly text: string;
	readonly emphasis: "quiet" | "attention";
};

export type RowOutcome =
	| { readonly kind: "running" }
	| { readonly kind: "settled"; readonly detail: RowDetail | undefined }
	| { readonly kind: "failed"; readonly reason: string | undefined };

export type RowSubject = {
	readonly text: string;
	readonly elide: "end" | "path";
};

export type ToolRow = {
	readonly verb: string;
	readonly subject: RowSubject | undefined;
	readonly outcome: RowOutcome;
};

type ShownDetail = {
	readonly text: string;
	readonly color: ThemeColor;
};

export const ROW_MARKER = "-";

export const RUNNING: RowOutcome = { kind: "running" };

const FAILED_MARKER = "✗";
const VERB_WIDTH = 5;
const GAP = " ";
const DETAIL_GAP = "  ";
const ELLIPSIS = "…";
const MIN_SUBJECT_WIDTH = 12;
const MIN_DETAIL_WIDTH = 10;

export function quiet(text: string): RowDetail {
	return { text, emphasis: "quiet" };
}

export function attention(text: string): RowDetail {
	return { text, emphasis: "attention" };
}

export function settled(detail: RowDetail | undefined): RowOutcome {
	return { kind: "settled", detail };
}

export function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

export function formatDuration(elapsedMs: number): string {
	const ms = Math.max(0, Math.round(elapsedMs));
	if (ms < 1_000) return `${ms}ms`;
	const tenths = Math.round(ms / 100);
	if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
	const seconds = Math.round(ms / 1_000);
	return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

function oneLine(text: string): string {
	return text.replace(/\s*[\r\n]+\s*/g, " ").replaceAll("\t", " ");
}

function elide(text: string, elision: RowSubject["elide"], max: number): string {
	if (max <= 0) return "";
	if (visibleWidth(text) <= max) return text;
	return elision === "end" ? truncateToWidth(text, max, ELLIPSIS) : shortenPath(text, max);
}

function detailOf(outcome: RowOutcome): ShownDetail | undefined {
	switch (outcome.kind) {
		case "running":
			return undefined;
		case "failed":
			return outcome.reason === undefined ? undefined : { text: oneLine(outcome.reason), color: "error" };
		case "settled":
			if (outcome.detail === undefined) return undefined;
			return {
				text: oneLine(outcome.detail.text),
				color: outcome.detail.emphasis === "attention" ? "warning" : "dim",
			};
	}
}

function fittedDetail(detail: ShownDetail, subject: string, room: number): ShownDetail | undefined {
	const wanted = visibleWidth(detail.text);
	const subjectNeed = Math.min(visibleWidth(subject), MIN_SUBJECT_WIDTH);
	const granted = Math.min(wanted, Math.max(0, room - DETAIL_GAP.length - subjectNeed));
	if (granted !== wanted && granted < MIN_DETAIL_WIDTH) return undefined;
	return { text: truncateToWidth(detail.text, granted, ELLIPSIS), color: detail.color };
}

export function formatToolRow(row: ToolRow, width: number, palette: RowPalette): string {
	if (width <= 0) return "";

	const failed = row.outcome.kind === "failed";
	const marker = failed ? FAILED_MARKER : ROW_MARKER;
	const verb = row.verb.padEnd(VERB_WIDTH, " ");
	const head = palette.fg(failed ? "error" : "dim", marker) + " " + palette.fg("text", verb) + GAP;
	const room = width - visibleWidth(`${marker} ${verb}${GAP}`);
	if (room <= 0) return truncateToWidth(head, width, "");

	const subjectText = row.subject === undefined ? ELLIPSIS : oneLine(row.subject.text);
	const wanted = detailOf(row.outcome);
	const detail = wanted === undefined ? undefined : fittedDetail(wanted, subjectText, room);
	const subjectRoom = detail === undefined ? room : room - DETAIL_GAP.length - visibleWidth(detail.text);
	const subject = elide(subjectText, row.subject?.elide ?? "end", subjectRoom);
	const tail = detail === undefined ? "" : DETAIL_GAP + palette.fg(detail.color, detail.text);
	return head + palette.fg(row.outcome.kind === "running" ? "dim" : "muted", subject) + tail;
}
