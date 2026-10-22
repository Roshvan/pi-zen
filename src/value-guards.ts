export type Reported<Value> = { readonly [Key in keyof Value]?: Value[Key] | null | undefined };

function isRecordOf<Value, Parsed>(value: Value): value is Value & Parsed {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRecord<Value, Parsed>(value: Value, fallback: Parsed): Parsed {
	return isRecordOf<Value, Parsed>(value) ? value : fallback;
}

export function isString<Value>(value: Value): value is Value & string {
	return typeof value === "string";
}

export function isFiniteNumber<Value>(value: Value): value is Value & number {
	return typeof value === "number" && Number.isFinite(value);
}
