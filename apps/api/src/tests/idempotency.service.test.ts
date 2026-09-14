import { afterEach, describe, expect, test } from "bun:test";
import { db, idempotencyKeys } from "@banking-ledger/db";
import { eq } from "drizzle-orm";
import { IdempotencyKeyReusedError } from "@api/features/idempotency/errors";
import { withIdempotency } from "@api/features/idempotency/services/idempotency.service";

const TEST_SCOPE = "test.idempotency";

afterEach(async () => {
	await db.delete(idempotencyKeys).where(eq(idempotencyKeys.scope, TEST_SCOPE));
});

describe("withIdempotency", () => {
	test("processes the operation when there is no idempotency key", async () => {
		let calls = 0;

		const { result, outcome } = await withIdempotency(TEST_SCOPE, null, { amount: 10 }, async () => {
			calls += 1;
			return { amount: 10 };
		});

		expect(outcome).toBe("processed");
		expect(result).toEqual({ amount: 10 });
		expect(calls).toBe(1);
	});

	test("processes the operation on the first call with a key", async () => {
		const key = crypto.randomUUID();
		let calls = 0;

		const { result, outcome } = await withIdempotency(TEST_SCOPE, key, { amount: 10 }, async () => {
			calls += 1;
			return { amount: 10 };
		});

		expect(outcome).toBe("processed");
		expect(result).toEqual({ amount: 10 });
		expect(calls).toBe(1);
	});

	test("replays the saved response on a second call with the same key and payload", async () => {
		const key = crypto.randomUUID();
		let calls = 0;
		const operation = async () => {
			calls += 1;
			return { amount: 10, callNumber: calls };
		};

		const first = await withIdempotency(TEST_SCOPE, key, { amount: 10 }, operation);
		const second = await withIdempotency(TEST_SCOPE, key, { amount: 10 }, operation);

		expect(first.outcome).toBe("processed");
		expect(second.outcome).toBe("duplicate");
		expect(second.result).toEqual(first.result);
		expect(calls).toBe(1);
	});

	test("rejects reusing the same key with a different payload", async () => {
		const key = crypto.randomUUID();

		await withIdempotency(TEST_SCOPE, key, { amount: 10 }, async () => ({ amount: 10 }));

		await expect(
			withIdempotency(TEST_SCOPE, key, { amount: 20 }, async () => ({ amount: 20 })),
		).rejects.toThrow(IdempotencyKeyReusedError);
	});

	test("collapses N concurrent requests with the same key into a single processed call", async () => {
		const key = crypto.randomUUID();
		let calls = 0;

		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				withIdempotency(TEST_SCOPE, key, { amount: 10 }, async () => {
					calls += 1;
					return { amount: 10 };
				}),
			),
		);

		const processed = results.filter((entry) => entry.outcome === "processed");
		const duplicated = results.filter((entry) => entry.outcome === "duplicate");

		expect(calls).toBe(1);
		expect(processed).toHaveLength(1);
		expect(duplicated).toHaveLength(3);
	});

	test("processes each request independently when there is no idempotency key (no dedup)", async () => {
		let calls = 0;

		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				withIdempotency(TEST_SCOPE, null, { amount: 10 }, async () => {
					calls += 1;
					return { amount: 10 };
				}),
			),
		);

		expect(calls).toBe(4);
		expect(results.every((entry) => entry.outcome === "processed")).toBe(true);
	});
});
