import { CustomEditor, type ExtensionUIContext, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";

import { applyRail, MIN_RAIL_PADDING } from "./editor-rail.ts";
import type { PromptHistory } from "./prompt-history.ts";
import type { UiPart } from "./ui-claim.ts";

type EditorFactory = ReturnType<ExtensionUIContext["getEditorComponent"]>;

function createZenEditor(
	tui: TUI,
	theme: EditorTheme,
	keybindings: KeybindingsManager,
	history: PromptHistory,
): CustomEditor {
	const editor = new CustomEditor(tui, theme, keybindings, { paddingX: MIN_RAIL_PADDING });
	const addToHistory = editor.addToHistory.bind(editor);
	const setPaddingX = editor.setPaddingX.bind(editor);
	const render = editor.render.bind(editor);
	history.replay(addToHistory);

	return Object.assign(editor, {
		addToHistory: (text: string): void => {
			addToHistory(text);
			history.remember(text);
		},
		setPaddingX: (padding: number): void => setPaddingX(Math.max(MIN_RAIL_PADDING, padding)),
		render: (width: number): string[] =>
			applyRail(render(width), editor.getPaddingX(), (glyph) => editor.borderColor(glyph)),
	});
}

export function zenEditorPart(history: PromptHistory): UiPart {
	let replaced: { readonly previous: EditorFactory } | undefined;
	return {
		show: (ui) => {
			replaced ??= { previous: ui.getEditorComponent() };
			ui.setEditorComponent((tui, theme, keybindings) => createZenEditor(tui, theme, keybindings, history));
		},
		hide: (ui) => {
			if (replaced === undefined) return;
			ui.setEditorComponent(replaced.previous);
			replaced = undefined;
		},
	};
}
