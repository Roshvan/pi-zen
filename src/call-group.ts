import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { ROW_MARKER, type RowPalette } from "./tool-row.ts";

/**
 * Labels a folded call can carry.
 *
 * Each one is the verb the call's own row would have shown, so a group line and
 * an ungrouped row name the same activity the same way.
 */
export const GROUP_LABELS = ["read", "list", "find", "grep", "run"] as const;

/** One folded-call label. */
export type GroupLabel = (typeof GROUP_LABELS)[number];

/** How many calls of each label a group has folded. */
export type GroupCounts = ReadonlyMap<GroupLabel, number>;

const SEPARATOR = " · ";
const ELLIPSIS = "…";

type RankedEntry = {
	readonly label: GroupLabel;
	readonly count: number;
};

function ranked(counts: GroupCounts): RankedEntry[] {
	const entries: RankedEntry[] = [];
	for (const label of GROUP_LABELS) {
		const count = counts.get(label) ?? 0;
		if (count > 0) entries.push({ label, count });
	}
	// Busiest label first. Sort is stable, so equal counts keep GROUP_LABELS order.
	return entries.sort((left, right) => right.count - left.count);
}

/**
 * Format the one line that stands in for a run of folded calls.
 *
 * A run of a single kind needs no breakdown, so it reads `- 3 read`. A mixed run
 * leads with the total and then names each kind, busiest first. As the line
 * narrows it drops whole segments from the end rather than truncating mid-count,
 * because a half-written number says less than nothing.
 *
 * @param counts - How many calls of each label the group folded.
 * @param width - Visible terminal width.
 * @param palette - Theme slice used to color the line.
 * @returns One line, never wider than `width`, empty when nothing was folded.
 */
export function formatGroupLine(counts: GroupCounts, width: number, palette: RowPalette): string {
	if (width <= 0) return "";

	const entries = ranked(counts);
	const [only] = entries;
	if (only === undefined) return "";

	const total = entries.reduce((sum, entry) => sum + entry.count, 0);
	const segments =
		entries.length === 1
			? [`${total} ${only.label}`]
			: [`${total} calls`, ...entries.map((entry) => `${entry.count} ${entry.label}`)];

	const prefix = ROW_MARKER + " ";
	const room = width - visibleWidth(prefix);
	if (room <= 0) return "";

	let kept = segments.length;
	while (kept > 1 && visibleWidth(segments.slice(0, kept).join(SEPARATOR)) > room) kept -= 1;
	const body = segments.slice(0, kept).join(SEPARATOR);
	const text = visibleWidth(body) <= room ? body : truncateToWidth(body, room, ELLIPSIS);

	return palette.fg("dim", ROW_MARKER) + " " + palette.fg("muted", text);
}

/**
 * A run of folded calls that share one line.
 *
 * The line is rendered by the run's leading member, so it lands where the first
 * of these calls appears in the transcript. A member that turns out to need a row
 * of its own leaves the run, and the lead passes to the next surviving member —
 * which keeps the line below any failure row that displaced it.
 */
export class CallGroup {
	private readonly counts = new Map<GroupLabel, number>();
	private readonly members: number[] = [];
	private nextId = 0;

	/**
	 * Join the run.
	 *
	 * @returns The new member's id.
	 */
	join(): number {
		const id = this.nextId;
		this.nextId += 1;
		this.members.push(id);
		return id;
	}

	/**
	 * Leave the run, without being counted in it.
	 *
	 * @param id - The member id returned by `join`.
	 */
	leave(id: number): void {
		const at = this.members.indexOf(id);
		if (at !== -1) this.members.splice(at, 1);
	}

	/**
	 * Whether this member renders the run's line.
	 *
	 * @param id - The member id returned by `join`.
	 * @returns True for the earliest member still in the run.
	 */
	leads(id: number): boolean {
		return this.members[0] === id;
	}

	/**
	 * Count one settled call.
	 *
	 * @param label - The verb the call would have shown on its own row.
	 */
	add(label: GroupLabel): void {
		this.counts.set(label, (this.counts.get(label) ?? 0) + 1);
	}

	/**
	 * How many calls the run has counted.
	 *
	 * @returns The total across every label.
	 */
	total(): number {
		let total = 0;
		for (const count of this.counts.values()) total += count;
		return total;
	}

	/**
	 * The counts the run's line renders from.
	 *
	 * This is the run's live map, not a copy: the line is rendered by the leading
	 * call, and it has to keep growing as the calls behind it settle.
	 *
	 * @returns The current counts.
	 */
	snapshot(): GroupCounts {
		return this.counts;
	}
}

/** A folded call's membership of a run. */
export type GroupSlot = {
	/** The run this call joined. */
	readonly group: CallGroup;
	/** This call's member id within the run. */
	readonly id: number;
};

/**
 * Tracks which run of folded calls is still open.
 *
 * Reads, listings, searches, and commands are how the model looks around; they
 * are rarely what the user came to see. One open run swallows them all until
 * something worth a line of its own happens — a code edit, a failure, or the end
 * of the turn — after which the next folded call starts a fresh run.
 */
export class CallGrouper {
	private open: CallGroup | undefined;

	/**
	 * Join a call to the open run, opening one if there is none.
	 *
	 * Called while the call is still streaming, so a run's line lands at the
	 * position of the first call in the run rather than the first one to finish.
	 *
	 * @returns The call's slot in the run.
	 */
	claim(): GroupSlot {
		const group = this.open ?? new CallGroup();
		this.open = group;
		return { group, id: group.join() };
	}

	/** End the open run, so the next folded call starts a new line. */
	close(): void {
		this.open = undefined;
	}
}
