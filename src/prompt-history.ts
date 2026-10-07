import {
	type ExtensionContext,
	type SessionStartEvent,
	sessionEntryToContextMessages,
} from "@earendil-works/pi-coding-agent";

const LIMIT = 100;

type SessionLog = Pick<ExtensionContext["sessionManager"], "buildContextEntries">;

type ContextMessage = ReturnType<typeof sessionEntryToContextMessages>[number];

type UserContent = Extract<ContextMessage, { readonly role: "user" }>["content"];

export type SeedOccasion = SessionStartEvent["reason"] | "zen on";

export type PromptHistory = {
	readonly replay: (add: (text: string) => void) => void;
	readonly remember: (text: string) => void;
	readonly seed: (session: SessionLog, occasion: SeedOccasion) => void;
};

declare global {
	var piZenPromptHistory: readonly string[] | undefined;
}

function rememberPrompt(newestFirst: readonly string[], text: string): readonly string[] {
	const trimmed = text.trim();
	if (trimmed === "" || newestFirst[0] === trimmed) return newestFirst;
	return [trimmed, ...newestFirst].slice(0, LIMIT);
}

function isPlainText(content: UserContent): content is string {
	return typeof content === "string";
}

function promptText(message: ContextMessage): readonly string[] {
	if (message.role !== "user") return [];
	const text = isPlainText(message.content)
		? message.content
		: message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
	return text === "" ? [] : [text];
}

function sessionPrompts(session: SessionLog): readonly string[] {
	return session.buildContextEntries().flatMap(sessionEntryToContextMessages).flatMap(promptText);
}

function withSessionOnTop(newestFirst: readonly string[], sessionOldestFirst: readonly string[]): readonly string[] {
	const session = sessionOldestFirst.reduce<readonly string[]>(rememberPrompt, []);
	const inSession = new Set(session);
	return [...session, ...newestFirst.filter((prompt) => !inSession.has(prompt))].slice(0, LIMIT);
}

function carriesSessionPrompts(occasion: SeedOccasion): boolean {
	switch (occasion) {
		case "startup":
		case "reload":
			return true;
		case "new":
		case "resume":
		case "fork":
		case "zen on":
			return false;
	}
}

export function carriedPromptHistory(): PromptHistory {
	const newestFirst = (): readonly string[] => globalThis.piZenPromptHistory ?? [];
	return {
		replay: (add) => {
			for (const prompt of [...newestFirst()].reverse()) add(prompt);
		},
		remember: (text) => {
			globalThis.piZenPromptHistory = rememberPrompt(newestFirst(), text);
		},
		seed: (session, occasion) => {
			if (carriesSessionPrompts(occasion)) return;
			globalThis.piZenPromptHistory = withSessionOnTop(newestFirst(), sessionPrompts(session));
		},
	};
}
