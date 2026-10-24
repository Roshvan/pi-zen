import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import type { UiPart } from "./ui-claim.ts";
import {
	activityPhrase,
	startingActivity,
	type ModelActivity,
	type WorkActivity,
	withoutTool,
	withModel,
	withTool,
} from "./work-activity.ts";

type WorkStatus = UiPart & {
	readonly begin: () => void;
	readonly model: (activity: ModelActivity) => void;
	readonly toolStarted: (id: string, label: string) => void;
	readonly toolEnded: (id: string) => void;
	readonly end: () => void;
};

export function createWorkStatus(now: () => number): WorkStatus {
	let shownOn: ExtensionUIContext | undefined;
	let activity: WorkActivity | undefined;
	let previousPhrase: string | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;

	const stopTicking = (): void => {
		if (ticker === undefined) return;
		clearInterval(ticker);
		ticker = undefined;
	};

	const refresh = (): void => {
		if (shownOn === undefined || activity === undefined) return;
		const phrase = activityPhrase(activity, now());
		if (previousPhrase !== phrase) shownOn.setWorkingMessage(shownOn.theme.fg("muted", phrase));
		previousPhrase = phrase;
	};

	const startTicking = (): void => {
		if (shownOn === undefined || activity === undefined || ticker !== undefined) return;
		ticker = setInterval(refresh, 1000);
		ticker.unref();
	};

	const work = (next: (activity: WorkActivity) => WorkActivity): void => {
		if (activity === undefined) return;
		activity = next(activity);
		refresh();
	};

	return {
		show: (ui) => {
			shownOn = ui;
			previousPhrase = undefined;
			refresh();
			startTicking();
		},
		hide: (ui) => {
			stopTicking();
			shownOn = undefined;
			previousPhrase = undefined;
			ui.setWorkingMessage();
		},
		begin: () => {
			stopTicking();
			activity = startingActivity(now());
			previousPhrase = undefined;
			refresh();
			startTicking();
		},
		model: (model) => work((current) => withModel(current, model, now())),
		toolStarted: (id, label) => work((current) => withTool(current, id, label)),
		toolEnded: (id) => work((current) => withoutTool(current, id, now())),
		end: () => {
			stopTicking();
			activity = undefined;
			previousPhrase = undefined;
			shownOn?.setWorkingMessage();
		},
	};
}
