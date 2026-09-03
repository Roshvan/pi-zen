import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";

/**
 * Remove the startup header.
 *
 * This covers the logo and the key-hint banner. The loaded-resource listing and
 * package-update notices are decided by the `quietStartup` setting before
 * extensions run, so a fully silent startup still wants `quietStartup: true`.
 *
 * @param ctx - The session's extension context.
 */
export function installBlankHeader(ctx: ExtensionContext): void {
	ctx.ui.setHeader(() => new Container());
}
