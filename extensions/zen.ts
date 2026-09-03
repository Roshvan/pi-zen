import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	SettingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";

import {
	BACKGROUNDLESS_THEME_NAME,
	snapshotTheme,
	withoutContentBackgrounds,
} from "../src/backgroundless-theme.ts";
import { CallGrouper } from "../src/call-group.ts";
import { type BuiltinToolOptions, registerCompactTools } from "../src/compact-tools.ts";
import { squeezeBlankLines } from "../src/markdown-compaction.ts";
import { installBlankHeader } from "../src/silent-header.ts";
import { thinkingTail, thinkingTailLineBudget } from "../src/thinking-tail.ts";
import { installQuietIndicator, restoreDefaultIndicator } from "../src/working-indicator.ts";
import { ZenEditor } from "../src/zen-editor.ts";

/** What Zen is doing in the current session. */
type ZenState =
	| { readonly kind: "off" }
	| {
			readonly kind: "on";
			readonly previousEditor: ReturnType<ExtensionContext["ui"]["getEditorComponent"]>;
			/** The active theme before Zen removed its content backgrounds. */
			readonly previousTheme: Theme;
			/** What `quietStartup` was set to before Zen claimed it. */
			readonly previousQuietStartup: boolean;
	  };

function settingsFor(ctx: ExtensionContext): SettingsManager {
	return SettingsManager.create(ctx.cwd, undefined, { projectTrusted: ctx.isProjectTrusted() });
}

function toolOptions(ctx: ExtensionContext): BuiltinToolOptions {
	const settings = settingsFor(ctx);
	return {
		autoResizeImages: settings.getImageAutoResize(),
		shellCommandPrefix: settings.getShellCommandPrefix(),
		shellPath: settings.getShellPath(),
	};
}

/**
 * Zen: a quieter Pi TUI.
 *
 * The extension owns the presentation layer only — chrome, editor frame, working
 * indicator, and how tool calls read. Nothing here changes what Pi executes,
 * what the model sees, or what a session records.
 *
 * There is one switch. `/zen on` is every part of it and `/zen off` is none of
 * it, because a quiet interface you have to configure is not one.
 *
 * @param pi - The extension API.
 */
export default function zen(pi: ExtensionAPI): void {
	let state: ZenState = { kind: "off" };
	let toolsRegistered = false;
	let deferredReloadInstall: ReturnType<typeof setTimeout> | undefined;
	let deferredThemeProjection: ReturnType<typeof setTimeout> | undefined;
	let activeContext: ExtensionContext | undefined;
	const grouper = new CallGrouper();

	// Installing is idempotent on purpose: another extension can take the header
	// or the editor at any time, so `/zen on` has to be able to claim them back.
	const install = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;

		const previousEditor = state.kind === "on" ? state.previousEditor : ctx.ui.getEditorComponent();
		let previousTheme = state.kind === "on" ? state.previousTheme : snapshotTheme(ctx.ui.theme);
		if (ctx.ui.theme.name !== BACKGROUNDLESS_THEME_NAME) {
			previousTheme = snapshotTheme(ctx.ui.theme);
			ctx.ui.setTheme(withoutContentBackgrounds(ctx.ui.theme));
		}

		// Pi reads quietStartup before extensions load, so this is the one thing Zen
		// cannot do for the session it is asked in — it takes effect next launch.
		const settings = settingsFor(ctx);
		const previousQuietStartup = state.kind === "on" ? state.previousQuietStartup : settings.getQuietStartup();
		if (!settings.getQuietStartup()) settings.setQuietStartup(true);

		installBlankHeader(ctx);
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new ZenEditor(tui, theme, keybindings));
		installQuietIndicator(ctx.ui);
		state = { kind: "on", previousEditor, previousTheme, previousQuietStartup };
	};

	// Pi has no public theme-change event for extensions. Markdown transformers
	// do rerun when the transcript redraws, so they can notice a newly selected
	// theme and project it on the next task without touching content.
	const projectChangedThemeSoon = () => {
		const ctx = activeContext;
		if (ctx === undefined || state.kind === "off" || ctx.ui.theme.name === BACKGROUNDLESS_THEME_NAME) return;
		if (deferredThemeProjection !== undefined) return;

		deferredThemeProjection = setTimeout(() => {
			deferredThemeProjection = undefined;
			if (state.kind === "off" || activeContext !== ctx || ctx.ui.theme.name === BACKGROUNDLESS_THEME_NAME) return;

			const previousTheme = snapshotTheme(ctx.ui.theme);
			ctx.ui.setTheme(withoutContentBackgrounds(ctx.ui.theme));
			installQuietIndicator(ctx.ui);
			state = { ...state, previousTheme };
		}, 0);
	};

	// `settings` is only given back when the user asks for Zen off. Shutting down is
	// not a change of mind, and reverting quietStartup there would undo it every
	// time pi closed.
	const restore = (ctx: ExtensionContext, give: "chrome" | "chrome and settings") => {
		if (state.kind === "off") return;
		if (give === "chrome and settings") {
			const settings = settingsFor(ctx);
			if (settings.getQuietStartup() !== state.previousQuietStartup) {
				settings.setQuietStartup(state.previousQuietStartup);
			}
		}
		if (ctx.ui.theme.name === BACKGROUNDLESS_THEME_NAME) ctx.ui.setTheme(state.previousTheme);
		ctx.ui.setHeader(undefined);
		ctx.ui.setEditorComponent(state.previousEditor);
		restoreDefaultIndicator(ctx.ui);
		state = { kind: "off" };
	};

	pi.on("session_start", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		activeContext = ctx;

		// Tool overrides are registered once per process: re-registering the same
		// names on a later session_start would stack duplicate definitions.
		if (!toolsRegistered) {
			registerCompactTools(pi, ctx.cwd, toolOptions(ctx), grouper, () => state.kind === "on");
			toolsRegistered = true;
		}
		install(ctx);

		// During /reload, Pi reapplies the saved theme after session_start. Reclaim
		// it on the next task so newly submitted messages stay backgroundless too.
		if (event.reason === "reload") {
			deferredReloadInstall = setTimeout(() => {
				deferredReloadInstall = undefined;
				if (state.kind === "on") install(ctx);
			}, 0);
		}
	});

	pi.on("turn_end", () => {
		// The next turn's reads belong to their own line, not to this turn's.
		grouper.close();
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (deferredReloadInstall !== undefined) {
			clearTimeout(deferredReloadInstall);
			deferredReloadInstall = undefined;
		}
		if (deferredThemeProjection !== undefined) {
			clearTimeout(deferredThemeProjection);
			deferredThemeProjection = undefined;
		}
		activeContext = undefined;
		restore(ctx, "chrome");
	});

	// Display-only: the session and the model keep the original markdown.
	pi.registerMarkdownTransformer((markdown, context) => {
		if (state.kind === "off") return markdown;
		projectChangedThemeSoon();
		if (context.messageType === "assistant-thinking" && context.isStreaming) {
			return thinkingTail(squeezeBlankLines(markdown), thinkingTailLineBudget(process.stdout.rows));
		}
		return squeezeBlankLines(markdown);
	});

	pi.registerCommand("zen", {
		description: "Quiet the TUI: on or off",
		getArgumentCompletions: (prefix) =>
			["on", "off"].filter((option) => option.startsWith(prefix)).map((option) => ({ value: option, label: option })),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const request = args.trim().toLowerCase();
			const wanted = request === "" ? state.kind === "off" : request !== "off";

			if (wanted) {
				const wasQuiet = settingsFor(ctx).getQuietStartup();
				install(ctx);
				ctx.ui.notify(wasQuiet ? "Zen on" : "Zen on · quiet startup from the next launch", "info");
				return;
			}
			if (deferredThemeProjection !== undefined) {
				clearTimeout(deferredThemeProjection);
				deferredThemeProjection = undefined;
			}
			restore(ctx, "chrome and settings");
			ctx.ui.notify("Zen off · tool frames return after Zen is disabled and Pi reloads", "info");
		},
	});
}
