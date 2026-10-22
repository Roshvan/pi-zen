import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Component, Container, type TUI } from "@earendil-works/pi-tui";

import type { UiPart } from "./ui-claim.ts";

type ReasoningPreferences = {
	readonly expanded: () => boolean;
	readonly nativeHidden: () => boolean;
};

type ReasoningMount = {
	readonly restore: (hidden: boolean) => void;
	readonly dispose: () => void;
};

const WIDGET_KEY = "zen-reasoning";

function assistantMessages(children: readonly Component[]): readonly AssistantMessageComponent[] {
	return children.flatMap((child) => {
		if (child instanceof AssistantMessageComponent) return [child];
		return child instanceof Container ? assistantMessages(child.children) : [];
	});
}

function mountReasoning(tui: TUI, hidden: boolean): ReasoningMount {
	const configured = new WeakSet<AssistantMessageComponent>();
	const previousRender = tui.requestRender;
	let active = true;

	const requestRender: TUI["requestRender"] = (force) => {
		if (active) {
			for (const message of assistantMessages(tui.children)) {
				if (configured.has(message)) continue;
				configured.add(message);
				message.setHideThinkingBlock(hidden);
			}
		}
		previousRender.call(tui, force);
	};

	const dispose = (): void => {
		active = false;
		if (tui.requestRender === requestRender) tui.requestRender = previousRender;
	};

	tui.requestRender = requestRender;
	requestRender();
	return {
		restore: (nativeHidden) => {
			dispose();
			for (const message of assistantMessages(tui.children)) {
				if (configured.has(message)) message.setHideThinkingBlock(nativeHidden);
			}
		},
		dispose,
	};
}

export function createReasoningView(preferences: ReasoningPreferences): UiPart {
	let mounted: ReasoningMount | undefined;
	return {
		show: (ui) => {
			ui.setHiddenThinkingLabel("Reasoning · click to reveal");
			ui.setWidget(WIDGET_KEY, (tui) => {
				const mount = mountReasoning(tui, !preferences.expanded());
				mounted = mount;
				return {
					render: () => [],
					invalidate: () => {},
					dispose: () => {
						mount.dispose();
						if (mounted === mount) mounted = undefined;
					},
				};
			});
		},
		hide: (ui) => {
			mounted?.restore(preferences.nativeHidden());
			ui.setWidget(WIDGET_KEY, undefined);
			ui.setHiddenThinkingLabel();
		},
	};
}
