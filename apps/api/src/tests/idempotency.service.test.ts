import { afterEach, describe, expect, test } from "bun:test";
import { db, idempotencyKeys } from "@banking-ledger/db";
import { eq } from "drizzle-orm";
import { IdempotencyKeyReusedError } from "@api/features/idempotency/errors";
import { withIdempotency } from "@api/features/idempotency/services/idempotency.service";

const TEST_SCOPE = "test.idempotency";

afterEach(async () => {
	await db.delete(idempotencyKeys).where(eq(idempotencyKeys.scope, TEST_SCOPE));
});

function effect<T>(result: T, transactionId: string | null = null) {
	return { transactionId, result };
}

describe("withIdempotency", () => {
	test("processes the operation when there is no idempotency key", async () => {
		let calls = 0;
		const principalId = crypto.randomUUID();

		const { result, outcome, transactionId } = await withIdempotency(
			principalId,
			TEST_SCOPE,
			null,
			{ amount: 10 },
			async () => {
				calls += 1;
				return effect({ amount: 10 });
			},
		);

		expect(outcome).toBe("processed");
		expect(result).toEqual({ amount: 10 });
		expect(transactionId).toBeNull();
		expect(calls).toBe(1);
	});

	test("processes the operation on the first call with a key", async () => {
		const principalId = crypto.randomUUID();
		const key = crypto.randomUUID();
		let calls = 0;

		const { result, outcome } = await withIdempotency(principalId, TEST_SCOPE, key, { amount: 10 }, async () => {
			calls += 1;
			return effect({ amount: 10 });
		});

		expect(outcome).toBe("processed");
		expect(result).toEqual({ amount: 10 });
		expect(calls).toBe(1);
	});

	test("replays the saved response on a second call with the same key and payload", async () => {
		const principalId = crypto.randomUUID();
		const key = crypto.randomUUID();
		let calls = 0;
		const operation = async () => {
			calls += 1;
			return effect({ amount: 10, callNumber: calls });
		};

		const first = await withIdempotency(principalId, TEST_SCOPE, key, { amount: 10 }, operation);
		const second = await withIdempotency(principalId, TEST_SCOPE, key, { amount: 10 }, operation);

		expect(first.outcome).toBe("processed");
		expect(second.outcome).toBe("duplicate");
		expect(second.result).toEqual(first.result);
		expect(second.transactionId).toBe(first.transactionId);
		expect(calls).toBe(1);
	});

	test("rejects reusing the same key with a different payload", async () => {
		const principalId = crypto.randomUUID();
		const key = crypto.randomUUID();

		await withIdempotency(principalId, TEST_SCOPE, key, { amount: 10 }, async () => effect({ amount: 10 }));

		await expect(
			withIdempotency(principalId, TEST_SCOPE, key, { amount: 20 }, async () => effect({ amount: 20 })),
		).rejects.toThrow(IdempotencyKeyReusedError);
	});

	test("treats reordered JSON keys as the same payload", async () => {
		const principalId = crypto.randomUUID();
		const key = crypto.randomUUID();
		let calls = 0;

		const first = await withIdempotency(
			principalId,
			TEST_SCOPE,
			key,
			{ amount: 100, accountId: "abc" },
			async () => {
				calls += 1;
				return effect({ amount: 100 });
			},
		);
		const second = await withIdempotency(
			principalId,
			TEST_SCOPE,
			key,
			{ accountId: "abc", amount: 100 },
			async () => effect({ amount: 999 }),
		);

		expect(first.outcome).toBe("processed");
		expect(second.outcome).toBe("duplicate");
		expect(second.result).toEqual({ amount: 100 });
		expect(calls).toBe(1);
	});

	test("does not let one principal replay another principal's response for the same key", async () => {
		const key = "shared-key";
		let calls = 0;

		const first = await withIdempotency(crypto.randomUUID(), TEST_SCOPE, key, { amount: 10 }, async () => {
			calls += 1;
			return effect({ owner: "A" });
		});
		const second = await withIdempotency(crypto.randomUUID(), TEST_SCOPE, key, { amount: 10 }, async () => {
			calls += 1;
			return effect({ owner: "B" });
		});

		expect(first.outcome).toBe("processed");
		expect(second.outcome).toBe("processed");
		expect(first.result).toEqual({ owner: "A" });
		expect(second.result).toEqual({ owner: "B" });
		expect(calls).toBe(2);
	});

	test("rolls the reservation back when the operation fails, so a later retry can proceed", async () => {
		const principalId = crypto.randomUUID();
		const key = crypto.randomUUID();
		let calls = 0;

		await expect(
			withIdempotency(principalId, TEST_SCOPE, key, { amount: 10 }, async () => {
				calls += 1;
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		const retry = await withIdempotency(principalId, TEST_SCOPE, key, { amount: 10 }, async () => {
			calls += 1;
			return effect({ ok: true });
		});

		expect(retry.outcome).toBe("processed");
		expect(retry.result).toEqual({ ok: true });
		expect(calls).toBe(2);
	});

	test("collapses N concurrent requests with the same key into a single processed call", async () => {
		const principalId = crypto.randomUUID();
		const key = crypto.randomUUID();
		let calls = 0;

		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				withIdempotency(principalId, TEST_SCOPE, key, { amount: 10 }, async () => {
					calls += 1;
					return effect({ amount: 10 });
				}),
			),
		);

		const processed = results.filter((entry) => entry.outcome === "processed");
		const duplicated = results.filter((entry) => entry.outcome === "duplicate");

		expect(calls).toBe(1);
		expect(processed).toHaveLength(1);
		expect(duplicated).toHaveLength(3);
	});

	test("processes concurrent requests with different keys independently", async () => {
		const principalId = crypto.randomUUID();
		let calls = 0;

		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				withIdempotency(principalId, TEST_SCOPE, crypto.randomUUID(), { amount: 10 }, async () => {
					calls += 1;
					return effect({ amount: 10 });
				}),
			),
		);

		expect(calls).toBe(4);
		expect(results.every((entry) => entry.outcome === "processed")).toBe(true);
	});

	test("processes each request independently when there is no idempotency key (no dedup)", async () => {
		const principalId = crypto.randomUUID();
		let calls = 0;

		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				withIdempotency(principalId, TEST_SCOPE, null, { amount: 10 }, async () => {
					calls += 1;
					return effect({ amount: 10 });
				}),
			),
		);

		expect(calls).toBe(4);
		expect(results.every((entry) => entry.outcome === "processed")).toBe(true);
	});
});
