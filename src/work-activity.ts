import type { TurnPhase } from "./turn-timing.ts";

type ToolCall = {
	readonly id: string;
	readonly label: string;
};

export type WorkActivity = {
	readonly phase: TurnPhase;
	readonly tools: readonly ToolCall[];
};

export const STARTING_ACTIVITY: WorkActivity = { phase: "thinking", tools: [] };

export function withPhase(activity: WorkActivity, phase: TurnPhase): WorkActivity {
	return { ...activity, phase };
}

export function withoutTool(activity: WorkActivity, id: string): WorkActivity {
	return { ...activity, tools: activity.tools.filter((tool) => tool.id !== id) };
}

export function withTool(activity: WorkActivity, id: string, label: string): WorkActivity {
	return { ...activity, tools: [...withoutTool(activity, id).tools, { id, label }] };
}

export function activityPhrase(activity: WorkActivity): string {
	if (activity.tools.length === 0) return activity.phase;
	const counts = new Map<string, number>();
	for (const tool of [...activity.tools].reverse()) counts.set(tool.label, (counts.get(tool.label) ?? 0) + 1);
	return [...counts].map(([label, count]) => count === 1 ? label : `${label} (${count})`).join(" · ");
}
