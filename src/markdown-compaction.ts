const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Collapse runs of blank lines down to one, leaving fenced code untouched.
 *
 * Pi's markdown renderer adds its own spacing after headings, paragraphs, and
 * lists, so a model that also emits double blank lines produces a transcript
 * with holes in it. Code fences keep every blank line, because there the
 * spacing is content.
 *
 * @param markdown - The markdown about to be rendered.
 * @returns The same markdown with no run of more than one blank line.
 */
export function squeezeBlankLines(markdown: string): string {
	const lines = markdown.split("\n");
	const kept: string[] = [];
	let fence: string | undefined;

	for (const line of lines) {
		const marker = FENCE.exec(line)?.[1];
		if (fence === undefined) {
			if (marker !== undefined) {
				fence = marker;
				kept.push(line);
				continue;
			}
		} else {
			// A closing fence must be at least as long as the one that opened it.
			if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
			kept.push(line);
			continue;
		}

		const blank = line.trim() === "";
		if (blank && kept.at(-1)?.trim() === "") continue;
		kept.push(line);
	}

	return kept.join("\n");
}
