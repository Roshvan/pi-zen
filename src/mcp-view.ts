import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container, Text } from "@earendil-works/pi-tui";

import {
	type Clock,
	elapsedOf,
	nothing,
	piCall,
	piResult,
	rowMemory,
	selfShell,
	settleClock,
	startClock,
} from "./pi-renderers.ts";
import { sourceLayout } from "./source-view.ts";
import { firstActionableLine, toolOutput } from "./tool-results.ts";
import { formatDuration, formatToolRow, quiet, RUNNING, settled, type ToolRow } from "./tool-row.ts";
import { widthCached } from "./width-cache.ts";

export function mcpRenderers(label: string, pi: ToolRenderers | undefined, showsZen: () => boolean, now: Clock): ToolRenderers {
	return selfShell(
		(args, theme, context) => {
			if (!showsZen()) return piCall(pi, args, theme, context) ?? nothing();
			startClock(context, now);
			return widthCached((width) => [formatToolRow({
				verb: "mcp",
				subject: { text: label, elide: "end" },
				outcome: RUNNING,
			}, width, theme)], []);
		},
		(result, options, theme, context) => {
			if (!showsZen()) return piResult(pi, result, options, theme, context) ?? nothing();
			if (!options.isPartial) settleClock(rowMemory(context), now);
			const elapsed = elapsedOf(context);
			const row: ToolRow = {
				verb: "mcp",
				subject: { text: label, elide: "end" },
				outcome: context.isError
					? { kind: "failed", reason: firstActionableLine(toolOutput(result.content).body) }
					: options.isPartial ? RUNNING : settled(elapsed === undefined ? undefined : quiet(formatDuration(elapsed))),
			};
			const heading = widthCached((width) => [formatToolRow(row, width, theme)], []);
			if (!context.expanded) return heading;
			const expanded = new Container();
			expanded.addChild(heading);
			expanded.addChild(sourceLayout({ path: "arguments.json", text: JSON.stringify(context.args, null, 2) ?? "{}", startLine: 1 }, theme));
			const body = piResult(pi, result, options, theme, context)
				?? new Text(theme.fg("toolOutput", toolOutput(result.content).body), 0, 0);
			const box = new Box(1, 0);
			box.addChild(body);
			expanded.addChild(box);
			return expanded;
		},
	);
}
