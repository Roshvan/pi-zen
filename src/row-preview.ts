import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, truncateToWidth } from "@earendil-works/pi-tui";

import { type SourceFile, sourceLayout } from "./source-view.ts";
import { formatToolRow, type ToolRow } from "./tool-row.ts";
import { widthCached } from "./width-cache.ts";

export type PreviewBody =
	| { readonly kind: "markdown"; readonly text: string }
	| { readonly kind: "source"; readonly file: SourceFile };

type Placement = {
	readonly indent: string;
	readonly whenEmpty: string | undefined;
};

type PlacedBody = {
	readonly content: Component;
	readonly placement: Placement;
};

const MARKDOWN_PLACEMENT: Placement = { indent: "  ", whenEmpty: "(no visible content)" };
const SOURCE_PLACEMENT: Placement = { indent: "", whenEmpty: undefined };

function markdownBody(source: string, theme: Theme): Component {
	return new Markdown(source, 0, 0, getMarkdownTheme(), { color: (text) => theme.fg("toolOutput", text) }, {
		renderLatex: false,
	});
}

function placed(body: PreviewBody, theme: Theme): PlacedBody {
	switch (body.kind) {
		case "markdown":
			return { content: markdownBody(body.text, theme), placement: MARKDOWN_PLACEMENT };
		case "source":
			return { content: sourceLayout(body.file, theme), placement: SOURCE_PLACEMENT };
	}
}

function layout(row: ToolRow, { content, placement }: PlacedBody, theme: Theme, width: number): string[] {
	const head = formatToolRow(row, width, theme);
	const room = width - placement.indent.length;
	if (room <= 0) return [head];

	const lines = content.render(room);
	if (lines.length > 0) return [head, "", ...lines.map((line) => placement.indent + line)];
	if (placement.whenEmpty === undefined) return [head];
	return [head, "", placement.indent + theme.fg("dim", truncateToWidth(placement.whenEmpty, room, "…"))];
}

export function rowPreview(row: ToolRow, body: PreviewBody, theme: Theme): Component {
	const shown = placed(body, theme);
	return widthCached((width) => layout(row, shown, theme, width), [shown.content]);
}
