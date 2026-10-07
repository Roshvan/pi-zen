import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { ROW_MARKER, type RowPalette } from "./tool-row.ts";

const GROUP_LABELS = ["read", "list", "find", "grep", "run"] as const;

export type GroupLabel = (typeof GROUP_LABELS)[number];

type GroupCounts = ReadonlyMap<GroupLabel, number>;

export type RunLine =
	| { readonly kind: "own row" }
	| { readonly kind: "hidden" }
	| { readonly kind: "group"; readonly counts: GroupCounts };

export type RunSeat = {
	readonly fold: (label: GroupLabel) => void;
	readonly stepApart: () => void;
	readonly line: () => RunLine;
};

export type CallRuns = {
	readonly join: (isExpanded: () => boolean) => RunSeat;
	readonly interrupt: () => RunSeat;
	readonly close: () => void;
};

type Standing =
	| { readonly kind: "pending" }
	| { readonly kind: "folded"; readonly label: GroupLabel }
	| { readonly kind: "apart" };

type Member = {
	readonly isExpanded: () => boolean;
	readonly standing: Standing;
};

type Run = {
	members: readonly Member[];
};

type RankedEntry = {
	readonly label: GroupLabel;
	readonly count: number;
};

const SEPARATOR = " · ";
const ELLIPSIS = "…";
const PENDING: Standing = { kind: "pending" };
const APART: Standing = { kind: "apart" };
const OWN_ROW: RunLine = { kind: "own row" };
const HIDDEN: RunLine = { kind: "hidden" };

export const OWN_SEAT: RunSeat = { fold: () => {}, stepApart: () => {}, line: () => OWN_ROW };

function ranked(counts: GroupCounts): RankedEntry[] {
	return GROUP_LABELS.map((label) => ({ label, count: counts.get(label) ?? 0 }))
		.filter((entry) => entry.count > 0)
		.sort((left, right) => right.count - left.count);
}

export function groupKey(counts: GroupCounts): string {
	return ranked(counts)
		.map((entry) => `${entry.count} ${entry.label}`)
		.join(SEPARATOR);
}

export function formatGroupLine(counts: GroupCounts, width: number, palette: RowPalette): string {
	const entries = ranked(counts);
	const [largest] = entries;
	const prefix = ROW_MARKER + " ";
	const room = width - visibleWidth(prefix);
	if (largest === undefined || room <= 0) return "";

	const total = entries.reduce((sum, entry) => sum + entry.count, 0);
	const segments =
		entries.length === 1
			? [`${total} ${largest.label}`]
			: [`${total} calls`, ...entries.map((entry) => `${entry.count} ${entry.label}`)];
	const body = segments
		.filter((_, index) => index === 0 || visibleWidth(segments.slice(0, index + 1).join(SEPARATOR)) <= room)
		.join(SEPARATOR);
	return palette.fg("dim", ROW_MARKER) + " " + palette.fg("muted", truncateToWidth(body, room, ELLIPSIS));
}

function isFolding(member: Member): boolean {
	return member.standing.kind !== "apart" && !member.isExpanded();
}

function acceptsMembers(run: Run): boolean {
	return run.members.every((member) => member.standing.kind === "pending");
}

function countsOf(run: Run): GroupCounts {
	return run.members.reduce((counts, member) => {
		if (member.standing.kind !== "folded" || !isFolding(member)) return counts;
		return counts.set(member.standing.label, (counts.get(member.standing.label) ?? 0) + 1);
	}, new Map<GroupLabel, number>());
}

function lineOf(run: Run, index: number): RunLine {
	const member = run.members[index];
	if (member === undefined || !isFolding(member)) return OWN_ROW;
	if (run.members.findIndex(isFolding) !== index) return HIDDEN;
	const counts = countsOf(run);
	const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
	return total > 1 ? { kind: "group", counts } : OWN_ROW;
}

function settle(run: Run, index: number, standing: Standing): void {
	run.members = run.members.map((member, at) =>
		at === index && member.standing.kind === "pending" ? { ...member, standing } : member,
	);
}

function seatIn(run: Run, index: number): RunSeat {
	return {
		fold: (label) => settle(run, index, { kind: "folded", label }),
		stepApart: () => settle(run, index, APART),
		line: () => lineOf(run, index),
	};
}

export function createCallRuns(): CallRuns {
	let open: Run | undefined;

	return {
		join: (isExpanded) => {
			const run = open !== undefined && acceptsMembers(open) ? open : { members: [] };
			run.members = [...run.members, { isExpanded, standing: PENDING }];
			open = run;
			return seatIn(run, run.members.length - 1);
		},
		interrupt: () => {
			open = undefined;
			return OWN_SEAT;
		},
		close: () => {
			open = undefined;
		},
	};
}
