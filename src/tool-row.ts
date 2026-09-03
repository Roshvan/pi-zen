import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** The slice of Pi's theme a tool row needs to paint itself. */
export type RowPalette = {
	readonly fg: (color: ThemeColor, text: string) => string;
};

/** Where a tool call has got to. */
export type RowOutcome =
	| { readonly kind: "running" }
	| { readonly kind: "settled" }
	| { readonly kind: "failed"; readonly reason: string | undefined };

/** The thing a tool acted on. */
export type RowSubject = {
	/** Path, command, or pattern. */
	readonly text: string;
	/** Which end survives truncation: paths keep their end, commands their start. */
	readonly keep: "start" | "end";
};

/** Short outcome detail such as `+8 −3` or `2.1s`. */
export type RowDetail = {
	/** The detail text. */
	readonly text: string;
	/** `attention` for detail the user may need to act on, such as truncation. */
	readonly emphasis: "quiet" | "attention";
};

/** One collapsed tool row. */
export type ToolRow = {
	/** Present-tense action, lower case, at most five columns. */
	readonly verb: string;
	/** What the tool acted on. */
	readonly subject: RowSubject;
	/** Outcome detail, when it adds something. */
	readonly detail: RowDetail | undefined;
	/** Where the call has got to. */
	readonly outcome: RowOutcome;
};

/** Marker for a pending or settled row. */
export const ROW_MARKER = "-";

/** Marker for a row whose tool failed. */
export const FAILED_MARKER = "✗";

const VERB_WIDTH = 5;
/** Between the verb column and the subject. */
const GAP = " ";
/** Before an outcome detail, which needs more separation than the subject. */
const DETAIL_GAP = "  ";
const ELLIPSIS = "…";
const MIN_SUBJECT_WIDTH = 12;
const MIN_DETAIL_WIDTH = 10;

function elide(subject: RowSubject, max: number): string {
	if (max <= 0) return "";
	if (visibleWidth(subject.text) <= max) return subject.text;
	if (subject.keep === "start") return truncateToWidth(subject.text, max, ELLIPSIS);

	const kept = max - visibleWidth(ELLIPSIS);
	if (kept <= 0) return ELLIPSIS.slice(0, max);
	return ELLIPSIS + subject.text.slice(subject.text.length - kept);
}

function markerColor(outcome: RowOutcome): ThemeColor {
	return outcome.kind === "failed" ? "error" : "dim";
}

function detailFor(row: ToolRow): { readonly text: string; readonly color: ThemeColor } | undefined {
	if (row.outcome.kind === "failed") {
		const reason = row.outcome.reason;
		return reason === undefined ? undefined : { text: reason, color: "error" };
	}
	if (row.detail === undefined) return undefined;
	return { text: row.detail.text, color: row.detail.emphasis === "attention" ? "warning" : "dim" };
}

/**
 * Format one collapsed tool row.
 *
 * The verb column is fixed so consecutive rows align. As the row narrows the
 * subject shrinks first, then the detail is truncated, and a detail left with no
 * useful room is dropped so the subject stays readable.
 *
 * @param row - The row to format.
 * @param width - Visible terminal width.
 * @param palette - Theme slice used to color the row.
 * @returns One line, never wider than `width`.
 */
export function formatToolRow(row: ToolRow, width: number, palette: RowPalette): string {
	if (width <= 0) return "";

	const marker = row.outcome.kind === "failed" ? FAILED_MARKER : ROW_MARKER;
	const verb = row.verb.padEnd(VERB_WIDTH, " ");
	const prefixWidth = visibleWidth(marker) + 1 + visibleWidth(verb) + GAP.length;
	const detail = detailFor(row);

	let subjectBudget = width - prefixWidth;
	let detailText: string | undefined;
	if (detail !== undefined) {
		// The detail may claim what is left once the subject keeps its floor. A
		// truncated failure reason still says what went wrong, so it is worth a
		// shorter subject; a detail with no room at all is dropped instead.
		const wanted = visibleWidth(detail.text);
		const subjectNeed = Math.min(visibleWidth(row.subject.text), MIN_SUBJECT_WIDTH);
		const available = Math.max(0, subjectBudget - DETAIL_GAP.length - subjectNeed);
		const granted = Math.min(wanted, available);
		if (granted === wanted || granted >= MIN_DETAIL_WIDTH) {
			detailText = truncateToWidth(detail.text, granted, ELLIPSIS);
			subjectBudget -= visibleWidth(detailText) + DETAIL_GAP.length;
		}
	}

	const subject = elide(row.subject, subjectBudget);
	let line = palette.fg(markerColor(row.outcome), marker) + " " + palette.fg("text", verb) + GAP;
	line += palette.fg(row.outcome.kind === "running" ? "dim" : "muted", subject);
	if (detailText !== undefined && detail !== undefined) {
		line += DETAIL_GAP + palette.fg(detail.color, detailText);
	}
	return line;
}
