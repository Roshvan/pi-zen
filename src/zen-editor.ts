import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

import { applyRail, MIN_RAIL_PADDING } from "./editor-rail.ts";

/**
 * Pi's editor with a rail instead of a frame.
 *
 * Every input behaviour comes from `CustomEditor`: app keybindings, history,
 * paste handling, autocomplete, IME support, and cursor geometry are inherited
 * untouched. Only the rendered rows are rewritten, and only in padding columns
 * the base editor left blank.
 */
export class ZenEditor extends CustomEditor {
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { paddingX: MIN_RAIL_PADDING });
	}

	/**
	 * Keep enough padding for the rail.
	 *
	 * Pi copies the app's configured padding onto a custom editor, and its
	 * default is zero, which would leave the rail nowhere to sit.
	 *
	 * @param padding - Padding requested by the app.
	 */
	override setPaddingX(padding: number): void {
		super.setPaddingX(Math.max(MIN_RAIL_PADDING, padding));
	}

	/**
	 * Render the editor with the Zen rail.
	 *
	 * @param width - Available terminal width.
	 * @returns The rows to draw.
	 */
	override render(width: number): string[] {
		return applyRail(super.render(width), this.getPaddingX(), (glyph) => this.borderColor(glyph));
	}
}
