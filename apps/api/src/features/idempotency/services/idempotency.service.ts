import { db, type DbClient } from "@banking-ledger/db";
import { IdempotencyKeyReusedError, IdempotencyRecordNotCompletedError } from "@api/features/idempotency/errors/idempotency.errors";
import { IdempotencyRepository } from "@api/features/idempotency/repositories/idempotency.repository";

export type IdempotencyOutcome = "processed" | "duplicate";

export type IdempotencyResult<T> = {
	result: T;
	outcome: IdempotencyOutcome;
};

function hashPayload(payload: unknown) {
	return new Bun.CryptoHasher("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function withIdempotency<T>(
	scope: string,
	key: string | null,
	requestPayload: unknown,
	operation: (tx: DbClient) => Promise<T>,
	client: DbClient = db,
): Promise<IdempotencyResult<T>> {
	if (!key) {
		return client.transaction(async (tx) => ({ result: await operation(tx), outcome: "processed" as const }));
	}

	const requestHash = hashPayload(requestPayload);

	return client.transaction(async (tx) => {
		const idempotencyRepository = new IdempotencyRepository(tx);
		const reserved = await idempotencyRepository.tryReserve({ scope, key, requestHash });

		if (reserved) {
			const result = await operation(tx);

			await idempotencyRepository.complete(reserved.id, {
				response: JSON.stringify(result),
				transactionId: null,
			});

			return { result, outcome: "processed" };
		}

		const existing = await idempotencyRepository.findByScopeAndKey(scope, key);

		if (!existing) {
			throw new IdempotencyRecordNotCompletedError(
				`Idempotency key "${key}" conflicted on insert but no record was found for scope "${scope}"`,
			);
		}

		if (existing.requestHash !== requestHash) {
			throw new IdempotencyKeyReusedError(
				`Idempotency key "${key}" was already used with a different request payload`,
			);
		}

		if (!existing.completedAt || !existing.response) {
			throw new IdempotencyRecordNotCompletedError(
				`Idempotency key "${key}" exists but was never completed`,
			);
		}

		return { result: JSON.parse(existing.response) as T, outcome: "duplicate" };
	});
}
