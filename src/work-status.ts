import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import type { TurnPhase } from "./turn-timing.ts";
import type { UiPart } from "./ui-claim.ts";
import {
	activityPhrase,
	STARTING_ACTIVITY,
	type WorkActivity,
	withoutTool,
	withPhase,
	withTool,
} from "./work-activity.ts";

type WorkStatus = UiPart & {
	readonly begin: () => void;
	readonly phase: (phase: TurnPhase) => void;
	readonly toolStarted: (id: string, label: string) => void;
	readonly toolEnded: (id: string) => void;
	readonly end: () => void;
};

type WorkLine =
	| { readonly _tag: "Resting"; readonly ui: ExtensionUIContext }
	| {
			readonly _tag: "Working";
			readonly ui: ExtensionUIContext;
			readonly activity: WorkActivity;
			readonly phrase: string;
	  };

export function createWorkStatus(): WorkStatus {
	let line: WorkLine | undefined;

	const work = (next: (activity: WorkActivity) => WorkActivity): void => {
		if (line === undefined) return;
		const { ui } = line;
		const activity = next(line._tag === "Working" ? line.activity : STARTING_ACTIVITY);
		const phrase = activityPhrase(activity);
		if (line._tag === "Resting" || line.phrase !== phrase) ui.setWorkingMessage(ui.theme.fg("text", phrase));
		line = { _tag: "Working", ui, activity, phrase };
	};

	const rest = (): void => {
		if (line === undefined) return;
		line.ui.setWorkingMessage();
		line = { _tag: "Resting", ui: line.ui };
	};

	return {
		show: (ui) => {
			if (line?.ui !== ui) line = { _tag: "Resting", ui };
		},
		hide: (ui) => {
			line = undefined;
			ui.setWorkingMessage();
		},
		begin: () => {
			if (line !== undefined) line = { _tag: "Resting", ui: line.ui };
			work(() => STARTING_ACTIVITY);
		},
		phase: (phase) => work((activity) => withPhase(activity, phase)),
		toolStarted: (id, label) => work((activity) => withTool(activity, id, label)),
		toolEnded: (id) => work((activity) => withoutTool(activity, id)),
		end: rest,
	};
}
