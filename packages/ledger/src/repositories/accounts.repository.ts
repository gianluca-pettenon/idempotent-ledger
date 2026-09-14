import { accounts, db, type DbClient } from "@banking-ledger/db";
import { and, eq, sql } from "drizzle-orm";

export class AccountsRepository {
	constructor(private readonly client: DbClient = db) {}

	async findByUserId(userId: string) {
		const [account] = await this.client.select().from(accounts).where(eq(accounts.userId, userId));

		return account;
	}

	async updateBalanceWithVersion(accountId: string, newBalance: number, expectedVersion: number) {
		return await this.client
			.update(accounts)
			.set({
				balance: newBalance,
				version: sql`${accounts.version} + 1`,
				updatedAt: new Date(),
			})
			.where(and(eq(accounts.id, accountId), eq(accounts.version, expectedVersion)))
			.returning();
	}
}
