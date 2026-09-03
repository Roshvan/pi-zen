import { homedir } from "node:os";
import { relative, resolve } from "node:path";

/**
 * Shorten a path for a tool row: paths inside the session directory become
 * relative, paths inside the home directory keep a `~`, and everything else is
 * left alone.
 *
 * @param path - Path as the model wrote it.
 * @param cwd - The session's working directory.
 * @returns The path to display.
 */
export function displayPath(path: string, cwd: string): string {
	if (path === "") return path;

	const absolute = resolve(cwd, path);
	const inside = relative(cwd, absolute);
	if (inside !== "" && !inside.startsWith("..")) return inside;

	const home = homedir();
	if (home !== "" && absolute.startsWith(`${home}/`)) return `~${absolute.slice(home.length)}`;
	return absolute;
}
