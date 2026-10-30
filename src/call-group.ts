import type { Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { type Component, MouseRegion, truncateToWidth } from "@earendil-works/pi-tui";

import { nothing, type RenderContext, type RenderedResult, rowMemory } from "./pi-renderers.ts";
import { displayToolName } from "./tool-calls.ts";

type Member = {
	readonly name: string;
	owner: symbol | undefined;
	hasResult: boolean;
	failures: number;
	running: boolean;
};

type Run = {
	readonly members: Member[];
	expanded: boolean;
	latestSuccess: Member | undefined;
};

type Seat = {
	readonly run: Run;
	readonly member: Member;
};

export type CallRuns = {
	readonly join: (id: string, name: string, owner?: symbol) => Seat;
	readonly close: () => void;
	readonly reset: () => void;
};

export function createCallRuns(rebuild: () => void = () => {}): CallRuns {
	const seats = new Map<string, Seat>();
	let open: Run | undefined;
	return {
		join: (id, name, owner) => {
			let existing = seats.get(id);
			if (owner !== undefined && existing?.member.owner !== undefined && existing.member.owner !== owner) {
				rebuild();
				existing = seats.get(id);
			}
			if (existing !== undefined) {
				if (owner !== undefined) existing.member.owner = owner;
				return existing;
			}
			open ??= { members: [], expanded: false, latestSuccess: undefined };
			const member: Member = { name, owner, hasResult: false, failures: 0, running: true };
			open.members.push(member);
			const seat = { run: open, member };
			seats.set(id, seat);
			return seat;
		},
		close: () => { open = undefined; },
		reset: () => { open = undefined; seats.clear(); },
	};
}

function summary(run: Run, expanded: boolean, width: number, theme: Theme): string {
	const counts = new Map<string, number>();
	for (const member of run.members) {
		const name = displayToolName(member.name);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	const failures = run.members.reduce((total, member) => total + member.failures, 0);
	const active = run.members.filter((member) => member.running);
	const labels = [...counts].map(([name, count]) => `${count} ${name}`);
	const status = [
		...(failures === 0 ? [] : [`${failures} failed`]),
		...(active.length === 0 ? [] : [`running ${active.map((member) => displayToolName(member.name)).join(", ")}`]),
	];
	const tail = status.length === 0 ? "" : ` · ${status.join(" · ")}`;
	const head = `${expanded ? "▾" : "▸"} tools  `;
	const room = Math.max(0, width - head.length - tail.length);
	const text = truncateToWidth(labels.join(" · "), room, "…");
	return truncateToWidth(theme.fg("muted", head + text) + theme.fg(failures > 0 ? "warning" : "dim", tail), width, "…");
}

function groupedView(seat: Seat, own: Component, slot: "call" | "result", theme: Theme, context: RenderContext): Component {
	const { run, member } = seat;
	const padding = " ".repeat(context.outputPad ?? 0);
	const component: Component = {
		invalidate: () => own.invalidate(),
		render: (width) => {
			if (member.hasResult !== (slot === "result")) return [];
			if (run.members.length < 2) return own.render(width);
			const first = run.members[0] === member;
			const room = width - padding.length * 2 - 1;
			const head = first && room > 0 ? [padding + summary(run, run.expanded || context.expanded, room, theme)] : [];
			if (!run.expanded && !context.expanded && member.failures === 0 && !member.running && member !== run.latestSuccess) return head;
			const indent = "  ";
			const body = width > indent.length ? own.render(width - indent.length).map((line) => indent + line) : [];
			return [...head, ...body];
		},
	};
	return new MouseRegion(component, (event) => {
		if (run.members.length < 2 || run.members[0] !== member || event.y !== 0 || event.type !== "click" || event.button !== "left") return undefined;
		run.expanded = !run.expanded;
		context.invalidate();
		return { handled: true };
	});
}

function ownerOf(context: RenderContext): symbol {
	return rowMemory(context).groupOwner ??= Symbol("zen-tool-row");
}

export function groupedRenderers(
	name: string,
	view: ToolRenderers,
	runs: CallRuns,
	showsZen: () => boolean,
	failures: (result: RenderedResult) => number = () => 0,
): ToolRenderers {
	return {
		...view,
		renderCall: (args, theme, context) => {
			const own = view.renderCall?.(args, theme, context) ?? nothing();
			if (!showsZen()) return own;
			const seat = runs.join(context.toolCallId, name, ownerOf(context));
			return groupedView(seat, own, "call", theme, context);
		},
		renderResult: (result, options, theme, context) => {
			const own = view.renderResult?.(result, options, theme, context) ?? nothing();
			if (!showsZen()) return own;
			const seat = runs.join(context.toolCallId, name, ownerOf(context));
			const wasRunning = seat.member.running;
			seat.member.hasResult = true;
			seat.member.running = options.isPartial;
			seat.member.failures = Math.max(context.isError ? 1 : 0, failures(result));
			if (wasRunning && !options.isPartial && seat.member.failures === 0) seat.run.latestSuccess = seat.member;
			return groupedView(seat, own, "result", theme, context);
		},
	};
}
