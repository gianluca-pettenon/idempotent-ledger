import { describe, expect, test } from "bun:test";
import { canonicalJson, deserializeJson, serializeJson } from "@api/features/idempotency/canonical-json";

describe("canonicalJson", () => {
	test("gives the same hash input when object keys are reordered", () => {
		expect(canonicalJson({ amount: 100, accountId: "abc" })).toBe(canonicalJson({ accountId: "abc", amount: 100 }));
	});

	test("treats a safe integer and the same bigint as one canonical number", () => {
		expect(canonicalJson({ amount: 100n, accountId: "abc" })).toBe(canonicalJson({ accountId: "abc", amount: 100 }));
	});

	test("sorts nested object keys", () => {
		expect(canonicalJson({ outer: { b: 1, a: 2 } })).toBe(canonicalJson({ outer: { a: 2, b: 1 } }));
	});

	test("preserves array order", () => {
		expect(canonicalJson({ ids: ["b", "a"] })).not.toBe(canonicalJson({ ids: ["a", "b"] }));
	});
});

describe("serializeJson", () => {
	test("round-trips bigint values", () => {
		const restored = deserializeJson<{ balance: bigint; version: bigint }>(
			serializeJson({ balance: 1500n, version: 2n }),
		);

		expect(restored.balance).toBe(1500n);
		expect(restored.version).toBe(2n);
	});
});
