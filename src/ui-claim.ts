import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export type UiPart = {
	readonly show: (ui: ExtensionUIContext) => void;
	readonly hide: (ui: ExtensionUIContext) => void;
};

type UiClaim = {
	readonly claim: (ui: ExtensionUIContext) => void;
	readonly release: () => void;
};

export function createUiClaim(parts: readonly UiPart[]): UiClaim {
	let claimed: ExtensionUIContext | undefined;

	const release = (): void => {
		const ui = claimed;
		if (ui === undefined) return;
		claimed = undefined;
		for (const part of [...parts].reverse()) part.hide(ui);
	};

	return {
		claim: (ui) => {
			if (claimed !== ui) release();
			claimed = ui;
			for (const part of parts) part.show(ui);
		},
		release,
	};
}
