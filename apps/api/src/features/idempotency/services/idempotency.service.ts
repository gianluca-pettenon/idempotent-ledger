import { db, type DbClient } from "@banking-ledger/db";
import { canonicalJson, deserializeJson, serializeJson } from "@api/features/idempotency/canonical-json";
import { IdempotencyKeyReusedError, IdempotencyRecordNotCompletedError } from "@api/features/idempotency/errors";
import { IdempotencyRepository } from "@api/features/idempotency/repositories/idempotency.repository";

export type IdempotencyOutcome = "processed" | "duplicate";

export type IdempotentEffect<T> = {
	transactionId: string | null;
	result: T;
};

export type IdempotencyResult<T> = {
	result: T;
	outcome: IdempotencyOutcome;
	transactionId: string | null;
};

function hashPayload(payload: unknown) {
	return new Bun.CryptoHasher("sha256").update(canonicalJson(payload)).digest("hex");
}

export async function withIdempotency<T>(
	principalId: string,
	scope: string,
	key: string | null,
	requestPayload: unknown,
	operation: (tx: DbClient) => Promise<IdempotentEffect<T>>,
	client: DbClient = db,
): Promise<IdempotencyResult<T>> {
	if (!key) {
		return client.transaction(async (tx) => {
			const effect = await operation(tx);

			return { result: effect.result, outcome: "processed" as const, transactionId: effect.transactionId };
		});
	}

	const requestHash = hashPayload(requestPayload);

	return client.transaction(async (tx) => {
		const idempotencyRepository = new IdempotencyRepository(tx);
		const reserved = await idempotencyRepository.tryReserve({ principalId, scope, key, requestHash });

		if (reserved) {
			const effect = await operation(tx);

			await idempotencyRepository.complete(reserved.id, {
				response: serializeJson(effect.result),
				transactionId: effect.transactionId,
			});

			return { result: effect.result, outcome: "processed", transactionId: effect.transactionId };
		}

		const existing = await idempotencyRepository.findByPrincipalScopeAndKey(principalId, scope, key);

		if (!existing) {
			throw new IdempotencyRecordNotCompletedError(
				`Idempotency key "${key}" conflicted on insert but no record was found for principal "${principalId}" and scope "${scope}"`,
			);
		}

		if (existing.requestHash !== requestHash) {
			throw new IdempotencyKeyReusedError(
				`Idempotency key "${key}" was already used with a different request payload`,
			);
		}

		if (!existing.completedAt || !existing.response) {
			throw new IdempotencyRecordNotCompletedError(`Idempotency key "${key}" exists but was never completed`);
		}

		return {
			result: deserializeJson<T>(existing.response),
			outcome: "duplicate",
			transactionId: existing.transactionId,
		};
	});
}
