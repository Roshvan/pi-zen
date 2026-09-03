import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

/** Frame interval that gives the four-frame pulse roughly one calm second per cycle. */
export const QUIET_INTERVAL_MS = 240;

/**
 * Replace Pi's spinner with a single dot that swells and fades.
 *
 * Frames are rendered verbatim by Pi, so they are colored here from the theme
 * that is active when the indicator is installed.
 *
 * @param ui - The session's UI context.
 */
export function installQuietIndicator(ui: ExtensionUIContext): void {
	const theme = ui.theme;
	ui.setWorkingIndicator({
		frames: [theme.fg("dim", "·"), theme.fg("dim", "•"), theme.fg("muted", "●"), theme.fg("dim", "•")],
		intervalMs: QUIET_INTERVAL_MS,
	});
}

/**
 * Restore Pi's default spinner.
 *
 * @param ui - The session's UI context.
 */
export function restoreDefaultIndicator(ui: ExtensionUIContext): void {
	ui.setWorkingIndicator();
}
