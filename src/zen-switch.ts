import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import type { QuietingOutcome, RestoringOutcome, StartupFailure } from "./startup-quieting.ts";

type Look = "zen" | "pi";

type ZenCommand = { readonly _tag: "Toggle" } | { readonly _tag: "Choose"; readonly look: Look };

type ParsedZenCommand =
	| { readonly _tag: "Command"; readonly command: ZenCommand }
	| { readonly _tag: "Unrecognized"; readonly argument: string };

type Notice = {
	readonly text: string;
	readonly level: "info" | "warning";
};

type CarriedLook = { look: Look };

export type ZenSwitch = {
	readonly look: () => Look;
	readonly turn: (command: ZenCommand) => Look;
};

declare global {
	var piZenSwitch: CarriedLook | undefined;
}

const CHOICES: ReadonlyMap<string, Look> = new Map([
	["on", "zen"],
	["off", "pi"],
]);

export const USAGE_NOTICE: Notice = { text: "Usage: /zen [on|off]", level: "warning" };

export const ON_OUTSIDE_TUI: Notice = { text: "Zen on · it shows in Pi's interactive terminal", level: "info" };

export function parseZenCommand(args: string): ParsedZenCommand {
	const argument = args.trim().toLowerCase();
	if (argument === "") return { _tag: "Command", command: { _tag: "Toggle" } };
	const look = CHOICES.get(argument);
	return look === undefined
		? { _tag: "Unrecognized", argument }
		: { _tag: "Command", command: { _tag: "Choose", look } };
}

export function zenCompletions(prefix: string): AutocompleteItem[] {
	return [...CHOICES.keys()].filter((word) => word.startsWith(prefix)).map((word) => ({ value: word, label: word }));
}

function lookAfter(command: ZenCommand, current: Look): Look {
	switch (command._tag) {
		case "Toggle":
			return current === "zen" ? "pi" : "zen";
		case "Choose":
			return command.look;
	}
}

export function carriedSwitch(): ZenSwitch {
	const carried = globalThis.piZenSwitch ?? { look: "zen" };
	globalThis.piZenSwitch = carried;
	return {
		look: () => carried.look,
		turn: (command) => {
			carried.look = lookAfter(command, carried.look);
			return carried.look;
		},
	};
}

function failedAction(failure: StartupFailure): "read" | "write" {
	switch (failure._tag) {
		case "SettingsUnreadable":
		case "ZenRecordUnreadable":
			return "read";
		case "SettingsUnwritable":
		case "ZenRecordUnwritable":
			return "write";
	}
}

function failureText(failure: StartupFailure): string {
	return `could not ${failedAction(failure)} ${failure.path} (${failure.detail})`;
}

function headOnly(head: string): Notice {
	return { text: head, level: "info" };
}

function headed(head: string, detail: Notice): Notice {
	return { text: `${head} · ${detail.text}`, level: detail.level };
}

export function startupNotice(outcome: QuietingOutcome): Notice | undefined {
	switch (outcome._tag) {
		case "Quieted":
			return {
				text: "Zen turned on quietStartup in Pi's settings, so Pi starts quietly from the next launch. /zen off turns it back off.",
				level: "info",
			};
		case "Failed":
			return { text: `Zen left quietStartup unchanged: ${failureText(outcome.failure)}`, level: "warning" };
		case "QuietedUnrecorded":
			return {
				text: `Zen turned on quietStartup in Pi's settings but ${failureText(outcome.failure)}, so /zen off will not turn it back off.`,
				level: "warning",
			};
		case "AlreadyQuiet":
		case "LeftToUser":
			return undefined;
	}
}

export function onNotice(outcome: QuietingOutcome): Notice {
	switch (outcome._tag) {
		case "Quieted":
			return headed("Zen on", { text: "quiet startup from the next launch", level: "info" });
		case "QuietedUnrecorded":
			return headed("Zen on", {
				text: `quiet startup from the next launch, but ${failureText(outcome.failure)}, so /zen off will leave it on`,
				level: "warning",
			});
		case "Failed":
			return headed("Zen on", { text: `quietStartup unchanged: ${failureText(outcome.failure)}`, level: "warning" });
		case "AlreadyQuiet":
		case "LeftToUser":
			return headOnly("Zen on");
	}
}

export function offNotice(outcome: RestoringOutcome): Notice {
	switch (outcome._tag) {
		case "Restored":
			return headed("Zen off", { text: "Pi's startup screen returns from the next launch", level: "info" });
		case "RestoredUnrecorded":
			return headed("Zen off", {
				text: `Pi's startup screen returns from the next launch, but ${failureText(outcome.failure)}`,
				level: "warning",
			});
		case "Failed":
			return headed("Zen off", {
				text: `quietStartup not restored: ${failureText(outcome.failure)}`,
				level: "warning",
			});
		case "NothingToRestore":
			return headOnly("Zen off");
	}
}

export function announce(ui: Pick<ExtensionUIContext, "notify">, notice: Notice): void {
	ui.notify(notice.text, notice.level);
}
