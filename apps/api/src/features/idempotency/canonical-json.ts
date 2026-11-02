export function canonicalJson(value: unknown): string {
	if (value === null) return "null";

	if (typeof value === "bigint") return value.toString();

	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("Cannot canonicalize a non-finite number");
		}

		return JSON.stringify(value);
	}

	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}

	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.sort();

		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
	}

	throw new Error(`Cannot canonicalize value of type ${typeof value}`);
}

function isBigintWrapper(value: unknown): value is { $bigint: string } {
	if (typeof value !== "object" || value === null || !("$bigint" in value)) return false;

	const wrapper = value as { $bigint: unknown };
	return typeof wrapper.$bigint === "string" && Object.keys(value).length === 1;
}

export function serializeJson(value: unknown) {
	return JSON.stringify(value, (_key, nested) => (typeof nested === "bigint" ? { $bigint: nested.toString() } : nested));
}

export function deserializeJson<T>(text: string): T {
	return JSON.parse(text, (_key, nested) => (isBigintWrapper(nested) ? BigInt(nested.$bigint) : nested)) as T;
}
