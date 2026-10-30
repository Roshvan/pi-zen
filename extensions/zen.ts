import { type ExtensionAPI, type ExtensionContext, getAgentDir, sessionEntryToContextMessages, SettingsManager } from "@earendil-works/pi-coding-agent";

import { liveSentInk } from "../src/backgroundless-theme.ts";
import { createCallRuns } from "../src/call-group.ts";
import { orientMessage } from "../src/message-orientation.ts";
import { carriedPromptHistory } from "../src/prompt-history.ts";
import { createReasoningView } from "../src/reasoning-view.ts";
import { silentHeader } from "../src/silent-header.ts";
import { createStartupQuieting } from "../src/startup-quieting.ts";
import { createThemeFollow } from "../src/theme-follow.ts";
import { hasZenToolView, toolInput, workLabel } from "../src/tool-calls.ts";
import { registerToolViews } from "../src/tool-views.ts";
import { createTurnStatus } from "../src/turn-status.ts";
import { phaseFromContent } from "../src/turn-timing.ts";
import { activityFromUpdate } from "../src/work-activity.ts";
import { createWorkStatus } from "../src/work-status.ts";
import { zenEditorPart } from "../src/zen-editor.ts";
import { createZenLifecycle } from "../src/zen-lifecycle.ts";
import { carriedSwitch, zenCompletions } from "../src/zen-switch.ts";

export default function zen(pi: ExtensionAPI): void {
	const zenSwitch = carriedSwitch();
	let sessionManager: ExtensionContext["sessionManager"] | undefined;
	const runs = createCallRuns(() => {
		if (sessionManager !== undefined) seedRuns(sessionManager);
	});
	const history = carriedPromptHistory();
	const turnStatus = createTurnStatus(Date.now);
	const workStatus = createWorkStatus(() => performance.now());
	const themeFollow = createThemeFollow();
	let cwd = process.cwd();
	let hasSpoken = false;
	const reasoningView = createReasoningView({
		nativeHidden: () => SettingsManager.create(cwd, getAgentDir()).getHideThinkingBlock(),
	});
	const lifecycle = createZenLifecycle({
		zenSwitch,
		history,
		startup: createStartupQuieting(getAgentDir()),
		parts: [silentHeader, zenEditorPart(history), turnStatus, workStatus, themeFollow, reasoningView],
	});
	const showsZen = (): boolean => zenSwitch.look() !== "pi";

	registerToolViews(pi, runs, showsZen, Date.now);

	const seedRuns = (manager: ExtensionContext["sessionManager"]): void => {
		runs.reset();
		for (const entry of manager.buildContextEntries()) {
			for (const message of sessionEntryToContextMessages(entry)) {
				if (message.role !== "assistant") {
					if (message.role !== "toolResult") runs.close();
					continue;
				}
				for (const block of message.content) {
					if (block.type === "text" && block.text.trim() !== "") runs.close();
					if (block.type === "toolCall") {
						if (hasZenToolView(block.name)) runs.join(block.id, block.name);
						else runs.close();
					}
				}
			}
		}
		runs.close();
	};

	pi.on("session_start", (event, ctx) => {
		cwd = ctx.cwd;
		sessionManager = ctx.sessionManager;
		seedRuns(ctx.sessionManager);
		return lifecycle.sessionStarted(event.reason, ctx);
	});

	pi.on("session_tree", (_event, ctx) => seedRuns(ctx.sessionManager));
	pi.on("session_compact", (_event, ctx) => seedRuns(ctx.sessionManager));

	pi.on("session_shutdown", () => {
		workStatus.end();
		lifecycle.sessionEnded();
	});

	pi.on("agent_start", () => {
		runs.close();
		turnStatus.begin();
		workStatus.begin();
	});

	pi.on("turn_start", () => {
		turnStatus.open();
		workStatus.model("waiting");
		themeFollow.sync();
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "user") runs.close();
		if (event.message.role === "assistant") {
			hasSpoken = false;
		}
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		if (!hasSpoken && event.message.content.some((block) => block.type === "text" && block.text.trim() !== "")) {
			hasSpoken = true;
			runs.close();
		}
		const activity = activityFromUpdate(event.assistantMessageEvent);
		if (activity !== undefined) workStatus.model(activity);
		const phase = phaseFromContent(event.message.content);
		if (phase === undefined) return;
		turnStatus.produce(phase, event.message.usage);
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		turnStatus.commit(event.message.usage);
		workStatus.model("waiting");
	});

	pi.on("tool_execution_start", (event) => {
		workStatus.toolStarted(event.toolCallId, workLabel(event.toolName, toolInput(event.args), cwd), event.parentToolCallId);
	});

	pi.on("tool_execution_end", (event) => {
		workStatus.toolEnded(event.toolCallId);
	});

	pi.on("agent_end", () => {
		turnStatus.end();
		workStatus.end();
	});

	pi.registerMarkdownTransformer((markdown, context) => {
		if (!showsZen()) return markdown;
		themeFollow.syncAfterRender();
		return orientMessage(markdown, context, liveSentInk());
	});

	pi.registerCommand("zen", {
		description: "Quiet the TUI: on, off, or details (alias for on)",
		getArgumentCompletions: zenCompletions,
		handler: lifecycle.command,
	});
}
