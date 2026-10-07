import { Container } from "@earendil-works/pi-tui";

import type { UiPart } from "./ui-claim.ts";

export const silentHeader: UiPart = {
	show: (ui) => ui.setHeader(() => new Container()),
	hide: (ui) => ui.setHeader(undefined),
};
