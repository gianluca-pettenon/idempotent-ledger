import { accounts, db, type DbClient } from "@banking-ledger/db";
import { and, eq, inArray, sql } from "drizzle-orm";

export class AccountsRepository {
	constructor(private readonly client: DbClient = db) {}

	async findByUserId(userId: string) {
		const [account] = await this.client.select().from(accounts).where(eq(accounts.userId, userId));

		return account;
	}

	async findById(id: string) {
		const [account] = await this.client.select().from(accounts).where(eq(accounts.id, id));

		return account;
	}

	async findByIds(ids: string[]) {
		if (!ids.length) {
			return [];
		}

		return this.client.select().from(accounts).where(inArray(accounts.id, ids));
	}

	async findSettlement(currency: string) {
		const [account] = await this.client
			.select()
			.from(accounts)
			.where(and(eq(accounts.kind, "settlement"), eq(accounts.currency, currency)));

		return account;
	}

	async updateBalanceWithVersion(accountId: string, newBalance: bigint, expectedVersion: bigint) {
		const [updated] = await this.client
			.update(accounts)
			.set({
				balance: newBalance,
				version: sql`${accounts.version} + 1`,
				updatedAt: new Date(),
			})
			.where(and(eq(accounts.id, accountId), eq(accounts.version, expectedVersion)))
			.returning();

		return updated;
	}
}
