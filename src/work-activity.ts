import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";

type ToolCall = {
	readonly id: string;
	readonly label: string;
};

export type ModelActivity = "waiting" | "reasoning" | "reasoning-unavailable" | "writing";

export type WorkActivity = {
	readonly model: ModelActivity;
	readonly lastOutputAt: number;
	readonly tools: readonly ToolCall[];
};

const SILENCE_MS = 10_000;

export function startingActivity(now: number): WorkActivity {
	return { model: "waiting", lastOutputAt: now, tools: [] };
}

export function activityFromUpdate(event: MessageUpdateEvent["assistantMessageEvent"]): ModelActivity | undefined {
	switch (event.type) {
		case "thinking_start":
		case "thinking_delta":
		case "thinking_end": {
			const block = event.partial.content[event.contentIndex];
			if (block?.type !== "thinking") return undefined;
			return block.redacted || (event.type === "thinking_end" && block.thinking.trim() === "")
				? "reasoning-unavailable"
				: "reasoning";
		}
		case "text_start":
		case "text_delta":
		case "text_end":
		case "toolcall_start":
		case "toolcall_delta":
		case "toolcall_end":
			return "writing";
		default:
			return undefined;
	}
}

export function withModel(activity: WorkActivity, model: ModelActivity, now: number): WorkActivity {
	return { ...activity, model, lastOutputAt: now };
}

export function withoutTool(activity: WorkActivity, id: string, now: number): WorkActivity {
	const tools = activity.tools.filter((tool) => tool.id !== id);
	return tools.length === 0 && activity.tools.length > 0
		? { model: "waiting", lastOutputAt: now, tools }
		: { ...activity, tools };
}

export function withTool(activity: WorkActivity, id: string, label: string): WorkActivity {
	return { ...activity, tools: [...activity.tools.filter((tool) => tool.id !== id), { id, label }] };
}

export function activityPhrase(activity: WorkActivity, now: number): string {
	if (activity.tools.length === 0) {
		const silence = Math.max(0, now - activity.lastOutputAt);
		if (silence >= SILENCE_MS) return `waiting for response · no model output for ${Math.floor(silence / 1000)}s`;
		switch (activity.model) {
			case "waiting": return "waiting for response";
			case "reasoning": return "reasoning";
			case "reasoning-unavailable": return "reasoning · text unavailable";
			case "writing": return "writing";
		}
	}
	const counts = new Map<string, number>();
	for (const tool of [...activity.tools].reverse()) counts.set(tool.label, (counts.get(tool.label) ?? 0) + 1);
	return [...counts].map(([label, count]) => count === 1 ? label : `${label} (${count})`).join(" · ");
}
