/** Added and removed line counts for an edit. */
export type EditChangeCount = {
	/** Lines the edit added. */
	readonly added: number;
	/** Lines the edit removed. */
	readonly removed: number;
};

/**
 * Count the lines a unified patch adds and removes.
 *
 * @param patch - The `patch` field of an edit result.
 * @returns Added and removed line counts, both zero for an empty patch.
 */
export function countPatchChanges(patch: string): EditChangeCount {
	let added = 0;
	let removed = 0;

	for (const line of patch.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		else if (line.startsWith("-")) removed++;
	}

	return { added, removed };
}

/**
 * Count the hunks in a unified patch.
 *
 * @param patch - The `patch` field of an edit result.
 * @returns The number of hunk headers in the patch.
 */
export function countPatchHunks(patch: string): number {
	let hunks = 0;
	for (const line of patch.split("\n")) if (line.startsWith("@@ ")) hunks += 1;
	return hunks;
}

/**
 * Render an edit's line counts the way diffs read.
 *
 * @param change - Added and removed line counts.
 * @returns A string such as `+8 −3`, or undefined when nothing changed.
 */
export function formatEditChange(change: EditChangeCount): string | undefined {
	if (change.added === 0 && change.removed === 0) return undefined;
	return `+${change.added} −${change.removed}`;
}

/**
 * Count the matches in grep output.
 *
 * Ripgrep prints `path:line:text` per match, so lines carrying a line number
 * are matches and context lines are not.
 *
 * @param output - Text the grep tool returned.
 * @returns The number of matching lines.
 */
export function countMatchLines(output: string): number {
	let matches = 0;
	for (const line of output.split("\n")) {
		if (/:\d+:/.test(line)) matches++;
	}
	return matches;
}

/**
 * Count the non-empty lines of output, for tools that print one result per line.
 *
 * @param output - Text the tool returned.
 * @returns The number of non-empty lines.
 */
export function countResultLines(output: string): number {
	let lines = 0;
	for (const line of output.split("\n")) {
		if (line.trim() !== "") lines++;
	}
	return lines;
}

/** Node appends the syscall and path to errno messages; the row already names the path. */
const ERRNO_PATH_CLAUSE =
	/,\s*(?:access|open|stat|lstat|scandir|read|write|unlink|mkdir|rmdir|copyfile|rename)\s+'[^']*'\s*$/;

/**
 * Pick the line that tells the user what went wrong.
 *
 * A node errno message repeats the path the row already shows, so that clause is
 * dropped to leave room for the part that explains the failure.
 *
 * @param output - Text the failed tool returned.
 * @returns The first non-empty line, or undefined when the output is blank.
 */
export function firstActionableLine(output: string): string | undefined {
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (trimmed !== "") return trimmed.replace(ERRNO_PATH_CLAUSE, "");
	}
	return undefined;
}

const BASH_STATUS = /^Command (?:exited with code (\d+)|aborted|timed out after (\S+) seconds)$/;

/**
 * Summarise why a bash call failed.
 *
 * Pi appends its own status sentence to the command output — an exit code, an
 * abort, or a timeout — so the status is the last line, and the first line of
 * output is what explains it.
 *
 * @param output - Text the failed bash call returned.
 * @returns A short reason such as `exit 1 · error TS2345: ...`, or undefined
 * when the call produced nothing at all.
 */
export function bashFailureSummary(output: string): string | undefined {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const last = lines.at(-1);
	const status = last === undefined ? null : BASH_STATUS.exec(last);
	if (status === null) return lines.at(0);

	const code = status[1];
	const timeout = status[2];
	const label = code !== undefined ? `exit ${code}` : timeout !== undefined ? `timeout ${timeout}s` : "aborted";
	const first = lines.at(0);
	if (first === undefined || first === last || first === "(no output)") return label;
	return `${label} · ${first}`;
}

/**
 * Reduce a shell command to its first line, so a heredoc or a multi-line
 * pipeline still occupies one transcript row.
 *
 * @param command - The command that was run.
 * @returns The first non-empty line, with a marker when more lines follow.
 */
export function commandHead(command: string): string {
	const lines = command.split("\n").filter((line) => line.trim() !== "");
	const head = lines.at(0)?.trim() ?? "";
	return lines.length > 1 ? `${head} …` : head;
}

/**
 * Format an elapsed duration for a tool row.
 *
 * @param elapsedMs - Milliseconds the tool ran.
 * @returns A short duration such as `240ms`, `2.1s`, or `3m04s`.
 */
export function formatDuration(elapsedMs: number): string {
	if (elapsedMs < 1_000) return `${Math.max(0, Math.round(elapsedMs))}ms`;
	if (elapsedMs < 60_000) return `${(elapsedMs / 1_000).toFixed(1)}s`;
	const minutes = Math.floor(elapsedMs / 60_000);
	const seconds = Math.round((elapsedMs % 60_000) / 1_000);
	return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

/**
 * Whether a tool returned a picture.
 *
 * A collapsed row cannot show an image, so it says one is there and leaves the
 * showing to the expanded view.
 *
 * @param content - Content blocks from the tool result.
 * @returns True when any block is an image.
 */
export function hasImage(content: readonly { readonly type: string }[]): boolean {
	return content.some((block) => block.type === "image");
}

/**
 * Pull the text a tool returned out of its content blocks.
 *
 * @param content - Content blocks from the tool result.
 * @returns The concatenated text, ignoring image blocks.
 */
export function textOf(content: readonly { readonly type: string; readonly text?: string }[]): string {
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
}
