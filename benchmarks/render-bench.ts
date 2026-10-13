import { performance } from "node:perf_hooks";

import { initTheme, type ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { ProcessTerminal, TuiMainScreen } from "@earendil-works/pi-tui";

// Local benchmark only: use Pi's host lifecycle and stable proxy, not a concrete
// theme or a benchmark-only diff view. These internals are not production imports.
import { createAllToolRenderers } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/renderers/index.js";
import { ToolExecutionComponent } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js";
import { liveTheme, quietLiveTheme } from "../src/backgroundless-theme.ts";
import { createCallRuns } from "../src/call-group.ts";
import { builtInTool, type ToolInput } from "../src/tool-calls.ts";
import { registerToolViews } from "../src/tool-views.ts";

class BenchmarkUI extends TuiMainScreen {
	override requestRender(): void {}
}

const ui = new BenchmarkUI(new ProcessTerminal());
const builtIns = createAllToolRenderers();
let resolver: ToolRendererResolver | undefined;
registerToolViews({ registerToolRenderer: (value) => { resolver = value; } }, createCallRuns(), () => true, () => 0);

function switchTheme(name: "dark" | "light"): void {
	initTheme(name, false);
	if (quietLiveTheme() === undefined) throw new Error("Pi theme did not initialize");
}

function elapsed(action: () => void): number {
	const start = performance.now();
	action();
	return Math.round((performance.now() - start) * 100) / 100;
}

type Fixture = {
	readonly name: string;
	readonly args: ToolInput;
	readonly text: string;
	readonly details?: unknown;
	readonly isError?: boolean;
};

let nextId = 0;
function tool(fixture: Fixture): ToolExecutionComponent {
	const name = builtInTool(fixture.name);
	const renderers = resolver?.(fixture.name, () => name === undefined ? undefined : builtIns[name]);
	if (renderers?.renderResult === undefined) throw new Error(`${fixture.name} renderer did not register`);
	const component = new ToolExecutionComponent(fixture.name, `bench-${nextId++}`, fixture.args, { showImages: false }, renderers, ui, "/tmp");
	component.markExecutionStarted();
	component.setArgsComplete();
	component.updateResult({ content: [{ type: "text", text: fixture.text }], details: fixture.details, isError: fixture.isError ?? false, durationMs: 12 });
	return component;
}

function patch(hunks: number): string {
	return Array.from({ length: hunks }, (_, index) => {
		const line = index * 10 + 1;
		return `@@ -${line},3 +${line},3 @@\n export function value${index}() {\n-  return "before";\n+  return "after with a deliberately long string to exercise wrapping at narrow terminal widths 日本語";\n }`;
	}).join("\n");
}

function lifecycle(fixture: Fixture, hunks?: number): void {
	switchTheme("dark");
	let row: ToolExecutionComponent | undefined;
	const coldCompactMs = elapsed(() => { row = tool(fixture); row.render(100); });
	if (row === undefined) throw new Error("Benchmark row was not constructed");
	const component = row;
	const redrawCompactMs = elapsed(() => {
		for (let index = 0; index < 1_000; index++) { component.invalidate(); component.render(100); }
	});
	const resizeCompactMs = elapsed(() => {
		for (let index = 0; index < 100; index++) { component.invalidate(); component.render(index % 2 === 0 ? 60 : 120); }
	});
	const coldExpandedMs = elapsed(() => { component.setExpanded(true); component.render(100); });
	const cachedExpandedMs = elapsed(() => {
		for (let index = 0; index < 1_000; index++) component.render(100);
	});
	const resizeExpandedMs = elapsed(() => {
		for (let index = 0; index < 20; index++) { component.invalidate(); component.render(index % 2 === 0 ? 60 : 120); }
	});
	const togglesMs = elapsed(() => {
		for (let index = 0; index < 100; index++) { component.setExpanded(index % 2 === 0); component.render(100); }
		component.setExpanded(true);
		component.render(100);
	});
	const themeExpandedMs = elapsed(() => { switchTheme("light"); component.invalidate(); component.render(100); });
	// Both view caches have been populated. Switch while each is mounted, then
	// activate the other to include inactive-view invalidation in the measurement.
	const themeCompactMs = elapsed(() => {
		component.setExpanded(false);
		component.render(100);
		switchTheme("dark");
		component.invalidate();
		component.render(100);
		component.setExpanded(true);
		component.render(100);
	});
	console.log(JSON.stringify({ tool: fixture.name, hunks, coldCompactMs, redrawCompactMs, resizeCompactMs, coldExpandedMs, cachedExpandedMs, resizeExpandedMs, togglesMs, themeExpandedMs, themeCompactMs }));
}

for (const hunks of [100, 1_000]) {
	lifecycle({ name: "edit", args: { path: "demo.ts" }, text: "Edited", details: { patch: patch(hunks) } }, hunks);
}
lifecycle({ name: "bash", args: { command: 'printf "hello"\nprintf "world"', timeout: 30 }, text: "stdout sentinel\nhello world\n\n[Showing lines 2-3 of 3. Full output: /tmp/bench-output]", details: { truncation: { truncated: true }, fullOutputPath: "/tmp/bench-output" } });
lifecycle({ name: "powershell", args: { command: 'Write-Output "hello"', timeout: 15 }, text: "stdout sentinel\nhello world" });
lifecycle({ name: "read", args: { path: "demo.ts" }, text: '/* a multiline\n * comment */\nexport const value = "source";\n' });
lifecycle({ name: "read", args: { path: "demo.md" }, text: '# Markdown\n\n```ts\nconst value = "source";\n```' });
lifecycle({ name: "write", args: { path: "demo.ts", content: 'export const value = "written";' }, text: "Written" });
lifecycle({ name: "read", args: { path: "demo.txt" }, text: "Plain output\nCompatibility fallback body" });
lifecycle({ name: "read", args: { path: "missing.txt" }, text: "ENOENT: missing file\nFull error body", isError: true });
lifecycle({ name: "codemode", args: { code: 'await tools.read({path: "missing.txt"});' }, text: "Script completed\nWall time 0.01 seconds\nOutput:\nNested failure", details: { calls: [{ name: "read", args: { path: "missing.txt" }, status: "error", error: "ENOENT: missing file", durationMs: 12 }] } });

switchTheme("dark");
let rows: ToolExecutionComponent[] = [];
const buildRowsMs = elapsed(() => { rows = Array.from({ length: 1_000 }, (_, index) => tool({ name: "edit", args: { path: `demo${index}.ts` }, text: "Edited", details: { patch: patch(1) } })); });
const coldRowsMs = elapsed(() => { for (const row of rows) row.render(100); });
const cachedRowsMs = elapsed(() => { for (const row of rows) row.render(100); });
const redrawRowsMs = elapsed(() => { for (const row of rows) { row.invalidate(); row.render(100); } });
const themeRowsMs = elapsed(() => { switchTheme("light"); for (const row of rows) { row.invalidate(); row.render(100); } });
console.log(JSON.stringify({ rows: rows.length, buildRowsMs, coldRowsMs, cachedRowsMs, redrawRowsMs, themeRowsMs }));

// Measure same-object palette changes for shell output and lazy highlights.
const shell = tool({ name: "bash", args: { command: 'printf "hello"', timeout: 30 }, text: "stdout sentinel" });
shell.setExpanded(true);
shell.render(100);
const active = liveTheme();
if (active === undefined) throw new Error("Pi theme did not initialize");
const fg = active.fg;
const getFgAnsi = active.getFgAnsi;
const paletteMutationMs = elapsed(() => {
	active.getFgAnsi = (color) => color === "text" || color === "syntaxString" ? "\x1b[38;5;201m" : getFgAnsi.call(active, color);
	active.fg = (color, text) => color === "text" || color === "toolOutput" || color === "syntaxString" ? `\x1b[38;5;201m${text}\x1b[39m` : fg.call(active, color, text);
	shell.invalidate();
	shell.render(100);
});
active.fg = fg;
active.getFgAnsi = getFgAnsi;
shell.invalidate();
shell.render(100);
shell.setExpanded(false);
const syntaxMutationMs = elapsed(() => {
	active.getFgAnsi = (color) => color === "syntaxString" ? "\x1b[38;5;201m" : getFgAnsi.call(active, color);
	active.fg = (color, text) => color === "syntaxString" ? `\x1b[38;5;201m${text}\x1b[39m` : fg.call(active, color, text);
	shell.invalidate();
	shell.render(100);
	shell.setExpanded(true);
	shell.render(100);
});
console.log(JSON.stringify({ paletteMutationMs, syntaxMutationMs }));
active.fg = fg;
active.getFgAnsi = getFgAnsi;
