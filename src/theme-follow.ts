import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";

import { quietLiveTheme, restoreLiveTheme } from "./backgroundless-theme.ts";
import type { UiPart } from "./ui-claim.ts";
import { installWorkingIndicator } from "./working-indicator.ts";

type ThemeFollow = UiPart & {
	readonly sync: () => void;
	readonly syncAfterRender: () => void;
};

type Following = {
	readonly ui: ExtensionUIContext;
	readonly drawnFor: Theme | undefined;
};

export function createThemeFollow(): ThemeFollow {
	let following: Following | undefined;
	let followUp: ReturnType<typeof setTimeout> | undefined;

	const draw = (ui: ExtensionUIContext): void => {
		const drawnFor = quietLiveTheme();
		installWorkingIndicator(ui);
		following = { ui, drawnFor };
	};

	const whenThemeMoved = (act: (ui: ExtensionUIContext) => void): void => {
		if (following !== undefined && quietLiveTheme() !== following.drawnFor) act(following.ui);
	};

	const sync = (): void => whenThemeMoved(draw);

	const syncSoon = (): void => {
		if (followUp !== undefined) return;
		followUp = setTimeout(() => {
			followUp = undefined;
			sync();
		}, 0);
		followUp.unref();
	};

	const cancelSync = (): void => {
		if (followUp === undefined) return;
		clearTimeout(followUp);
		followUp = undefined;
	};

	return {
		show: (ui) => {
			draw(ui);
			syncSoon();
		},
		hide: (ui) => {
			cancelSync();
			following = undefined;
			restoreLiveTheme();
			ui.setWorkingIndicator();
		},
		sync,
		syncAfterRender: () => whenThemeMoved(syncSoon),
	};
}
