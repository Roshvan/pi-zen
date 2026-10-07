import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

import { createCallRuns } from "../src/call-group.ts";
import { squeezeBlankLines } from "../src/markdown-compaction.ts";
import { carriedPromptHistory } from "../src/prompt-history.ts";
import { silentHeader } from "../src/silent-header.ts";
import { createStartupQuieting } from "../src/startup-quieting.ts";
import { createThemeFollow } from "../src/theme-follow.ts";
import { thinkingTail, thinkingTailLineBudget } from "../src/thinking-tail.ts";
import { registerToolViews } from "../src/tool-views.ts";
import { createTurnStatus } from "../src/turn-status.ts";
import { phaseFromContent } from "../src/turn-timing.ts";
import { zenEditorPart } from "../src/zen-editor.ts";
import { createZenLifecycle } from "../src/zen-lifecycle.ts";
import { carriedSwitch, zenCompletions } from "../src/zen-switch.ts";

export default function zen(pi: ExtensionAPI): void {
	const zenSwitch = carriedSwitch();
	const runs = createCallRuns();
	const history = carriedPromptHistory();
	const turnStatus = createTurnStatus(Date.now);
	const themeFollow = createThemeFollow();
	const lifecycle = createZenLifecycle({
		zenSwitch,
		history,
		startup: createStartupQuieting(getAgentDir()),
		parts: [silentHeader, zenEditorPart(history), turnStatus, themeFollow],
	});
	const showsZen = (): boolean => zenSwitch.look() === "zen";

	registerToolViews(pi, runs, showsZen, Date.now);

	pi.on("session_start", (event, ctx) => lifecycle.sessionStarted(event.reason, ctx));

	pi.on("session_shutdown", () => {
		lifecycle.sessionEnded();
	});

	pi.on("agent_start", () => {
		runs.close();
		turnStatus.begin();
	});

	pi.on("turn_start", () => {
		themeFollow.sync();
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") turnStatus.open();
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		const phase = phaseFromContent(event.message.content);
		if (phase === undefined) return;
		turnStatus.produce(phase, event.message.usage);
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		turnStatus.commit(event.message.usage);
	});

	pi.on("turn_end", () => {
		runs.close();
	});

	pi.on("agent_end", () => {
		turnStatus.end();
	});

	pi.registerMarkdownTransformer((markdown, context) => {
		if (!showsZen()) return markdown;
		themeFollow.syncAfterRender();
		const squeezed = squeezeBlankLines(markdown);
		if (context.messageType === "assistant-thinking" && context.isStreaming) {
			return thinkingTail(squeezed, thinkingTailLineBudget(process.stdout.rows));
		}
		return squeezed;
	});

	pi.registerCommand("zen", {
		description: "Quiet the TUI: on or off",
		getArgumentCompletions: zenCompletions,
		handler: lifecycle.command,
	});
}
