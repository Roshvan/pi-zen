import type { ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";

import type { PromptHistory, SeedOccasion } from "./prompt-history.ts";
import type { QuietingOutcome, RestoringOutcome, StartupQuieting } from "./startup-quieting.ts";
import { createUiClaim, type UiPart } from "./ui-claim.ts";
import {
	announce,
	offNotice,
	ON_OUTSIDE_TUI,
	onNotice,
	parseZenCommand,
	startupNotice,
	USAGE_NOTICE,
	type ZenSwitch,
} from "./zen-switch.ts";

type ZenHost = Pick<ExtensionContext, "mode" | "ui" | "cwd" | "sessionManager">;

type ZenLifecycleDependencies = {
	readonly zenSwitch: ZenSwitch;
	readonly history: PromptHistory;
	readonly startup: StartupQuieting;
	readonly parts: readonly UiPart[];
};

type ZenLifecycle = {
	readonly sessionStarted: (reason: SessionStartEvent["reason"], host: ZenHost) => Promise<void>;
	readonly sessionEnded: () => void;
	readonly command: (args: string, host: ZenHost) => Promise<void>;
};

export function createZenLifecycle({ zenSwitch, history, startup, parts }: ZenLifecycleDependencies): ZenLifecycle {
	const zenUi = createUiClaim(parts);

	const enter = (host: ZenHost, occasion: SeedOccasion): Promise<QuietingOutcome> => {
		history.seed(host.sessionManager, occasion);
		zenUi.claim(host.ui);
		return startup.quiet(host.cwd);
	};

	const leave = (host: ZenHost): Promise<RestoringOutcome> => {
		zenUi.release();
		return startup.restore(host.cwd);
	};

	return {
		sessionStarted: async (reason, host) => {
			if (host.mode !== "tui" || zenSwitch.look() !== "zen") return;
			const notice = startupNotice(await enter(host, reason));
			if (notice !== undefined) announce(host.ui, notice);
		},
		sessionEnded: () => zenUi.release(),
		command: async (args, host) => {
			const parsed = parseZenCommand(args);
			if (parsed._tag === "Unrecognized") {
				announce(host.ui, USAGE_NOTICE);
				return;
			}
			if (zenSwitch.turn(parsed.command) === "pi") {
				announce(host.ui, offNotice(await leave(host)));
				return;
			}
			if (host.mode !== "tui") {
				announce(host.ui, ON_OUTSIDE_TUI);
				return;
			}
			announce(host.ui, onNotice(await enter(host, "zen on")));
		},
	};
}
