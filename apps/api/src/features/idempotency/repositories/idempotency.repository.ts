import { db, type DbClient, idempotencyKeys } from "@banking-ledger/db";
import { and, eq } from "drizzle-orm";

type ReserveParams = {
	scope: string;
	key: string;
	requestHash: string;
};

type CompleteParams = {
	response: string;
	transactionId: string | null;
};

export class IdempotencyRepository {
	constructor(private readonly client: DbClient = db) {}

	async tryReserve(params: ReserveParams) {
		const [reserved] = await this.client
			.insert(idempotencyKeys)
			.values(params)
			.onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
			.returning();

		return reserved;
	}

	async findByScopeAndKey(scope: string, key: string) {
		const [record] = await this.client
			.select()
			.from(idempotencyKeys)
			.where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));

		return record;
	}

	async complete(id: string, params: CompleteParams) {
		const [completed] = await this.client
			.update(idempotencyKeys)
			.set({
				response: params.response,
				transactionId: params.transactionId,
				completedAt: new Date(),
			})
			.where(eq(idempotencyKeys.id, id))
			.returning();

		return completed;
	}
}
