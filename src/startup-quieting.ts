import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type QuietStartup, SettingsManager } from "@earendil-works/pi-coding-agent";

type Result<T, E> = { readonly _tag: "ok"; readonly value: T } | { readonly _tag: "err"; readonly error: E };

export type StartupFailure = {
	readonly _tag: "SettingsUnreadable" | "SettingsUnwritable" | "ZenRecordUnreadable" | "ZenRecordUnwritable";
	readonly path: string;
	readonly detail: string;
};

export type QuietingOutcome =
	| { readonly _tag: "AlreadyQuiet" }
	| { readonly _tag: "LeftToUser" }
	| { readonly _tag: "Quieted" }
	| { readonly _tag: "QuietedUnrecorded"; readonly failure: StartupFailure }
	| { readonly _tag: "Failed"; readonly failure: StartupFailure };

export type RestoringOutcome =
	| { readonly _tag: "NothingToRestore" }
	| { readonly _tag: "Restored" }
	| { readonly _tag: "RestoredUnrecorded"; readonly failure: StartupFailure }
	| { readonly _tag: "Failed"; readonly failure: StartupFailure };

export type StartupQuieting = {
	readonly quiet: (cwd: string) => Promise<QuietingOutcome>;
	readonly restore: (cwd: string) => Promise<RestoringOutcome>;
};

type QuietStartupOrigin = "set by zen" | "the user's own";

type GlobalStartupSetting = {
	readonly current: QuietStartup | undefined;
	readonly write: (value: QuietStartup) => Promise<Result<QuietStartup, StartupFailure>>;
};

const RECORD_FILE = "pi-zen.json";
const SET_BY_ZEN = "set by zen";

type ZenRecord = { readonly quietStartup: typeof SET_BY_ZEN };

const ZEN_RECORD: ZenRecord = { quietStartup: SET_BY_ZEN };

function ok<T>(value: T): Result<T, never> {
	return { _tag: "ok", value };
}

function err<E>(error: E): Result<never, E> {
	return { _tag: "err", error };
}

function describe(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function isMissingFile(cause: unknown): boolean {
	return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

function readOptionalText(path: string): Result<string | undefined, string> {
	try {
		return ok(readFileSync(path, "utf8"));
	} catch (cause) {
		return isMissingFile(cause) ? ok(undefined) : err(describe(cause));
	}
}

function attempt<T>(run: () => T): Result<T, string> {
	try {
		return ok(run());
	} catch (cause) {
		return err(describe(cause));
	}
}

function globalFailure(manager: SettingsManager): string | undefined {
	const failures = manager.drainErrors().filter((failure) => failure.scope === "global");
	return failures.length === 0 ? undefined : failures.map((failure) => failure.error.message).join("; ");
}

function openGlobalStartupSetting(cwd: string, agentDir: string): Result<GlobalStartupSetting, StartupFailure> {
	const path = join(agentDir, "settings.json");
	const unreadable = (detail: string): Result<never, StartupFailure> => err({ _tag: "SettingsUnreadable", path, detail });
	const unwritable = (detail: string): Result<never, StartupFailure> => err({ _tag: "SettingsUnwritable", path, detail });

	const opened = attempt(() => SettingsManager.create(cwd, agentDir, { projectTrusted: false }));
	if (opened._tag === "err") return unreadable(opened.error);
	const manager = opened.value;
	const loadFailure = globalFailure(manager);
	if (loadFailure !== undefined) return unreadable(loadFailure);

	return ok({
		current: manager.getGlobalSettings().quietStartup,
		write: async (value) => {
			const queued = attempt(() => manager.setQuietStartup(value));
			if (queued._tag === "err") return unwritable(queued.error);
			await manager.flush();
			const writeFailure = globalFailure(manager);
			return writeFailure === undefined ? ok(value) : unwritable(writeFailure);
		},
	});
}

function isZenRecord<Value>(value: Value): value is Value & ZenRecord {
	return typeof value === "object" && value !== null && "quietStartup" in value && value.quietStartup === SET_BY_ZEN;
}

function originOf<Value>(stored: Value): QuietStartupOrigin {
	return isZenRecord(stored) ? "set by zen" : "the user's own";
}

function readOrigin(path: string): Result<QuietStartupOrigin, StartupFailure> {
	const unreadable = (detail: string): Result<never, StartupFailure> =>
		err({ _tag: "ZenRecordUnreadable", path, detail });
	const text = readOptionalText(path);
	if (text._tag === "err") return unreadable(text.error);
	const stored = text.value;
	if (stored === undefined) return ok("the user's own");
	const parsed = attempt(() => {
		const json: unknown = JSON.parse(stored);
		return originOf(json);
	});
	return parsed._tag === "ok" ? parsed : unreadable(parsed.error);
}

function recordOrigin(path: string, agentDir: string, origin: QuietStartupOrigin): Result<QuietStartupOrigin, StartupFailure> {
	const written = attempt(() => {
		if (origin === "the user's own") {
			rmSync(path, { force: true });
			return origin;
		}
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(path, `${JSON.stringify(ZEN_RECORD, null, "\t")}\n`);
		return origin;
	});
	return written._tag === "ok" ? written : err({ _tag: "ZenRecordUnwritable", path, detail: written.error });
}

function isQuiet(value: QuietStartup | undefined): boolean {
	return value === true || value === "header";
}

export function createStartupQuieting(agentDir: string): StartupQuieting {
	const recordPath = join(agentDir, RECORD_FILE);

	const quiet = async (cwd: string): Promise<QuietingOutcome> => {
		const setting = openGlobalStartupSetting(cwd, agentDir);
		if (setting._tag === "err") return { _tag: "Failed", failure: setting.error };
		if (isQuiet(setting.value.current)) return { _tag: "AlreadyQuiet" };

		const origin = readOrigin(recordPath);
		if (origin._tag === "err") return { _tag: "Failed", failure: origin.error };
		if (origin.value === "set by zen") return { _tag: "LeftToUser" };

		const written = await setting.value.write(true);
		if (written._tag === "err") return { _tag: "Failed", failure: written.error };

		const recorded = recordOrigin(recordPath, agentDir, "set by zen");
		return recorded._tag === "ok" ? { _tag: "Quieted" } : { _tag: "QuietedUnrecorded", failure: recorded.error };
	};

	const restore = async (cwd: string): Promise<RestoringOutcome> => {
		const origin = readOrigin(recordPath);
		if (origin._tag === "err") return { _tag: "Failed", failure: origin.error };
		if (origin.value === "the user's own") return { _tag: "NothingToRestore" };

		const setting = openGlobalStartupSetting(cwd, agentDir);
		if (setting._tag === "err") return { _tag: "Failed", failure: setting.error };
		const unchanged = setting.value.current === true;
		if (unchanged) {
			const written = await setting.value.write(false);
			if (written._tag === "err") return { _tag: "Failed", failure: written.error };
		}

		const cleared = recordOrigin(recordPath, agentDir, "the user's own");
		if (cleared._tag === "err") {
			return unchanged ? { _tag: "RestoredUnrecorded", failure: cleared.error } : { _tag: "Failed", failure: cleared.error };
		}
		return unchanged ? { _tag: "Restored" } : { _tag: "NothingToRestore" };
	};

	return { quiet, restore };
}
