import {
	accounts,
	db,
	entries as entriesTable,
	transactions,
	type DbClient,
	type entryType,
	type transactionType,
	users,
} from "@banking-ledger/db";
import { alias } from "drizzle-orm/pg-core";
import { desc, eq } from "drizzle-orm";

type NewTransaction = {
	type: (typeof transactionType.enumValues)[number];
	amount: number;
	requestId: string;
	idempotencyKey: string | null;
	fromAccountId: string | null;
	toAccountId: string | null;
};

type NewEntry = {
	transactionId: string;
	accountId: string;
	type: (typeof entryType.enumValues)[number];
	amount: number;
};

const fromAccounts = alias(accounts, "from_accounts");
const fromUsers = alias(users, "from_users");
const toAccounts = alias(accounts, "to_accounts");
const toUsers = alias(users, "to_users");

export class LedgerRepository {
	constructor(private readonly client: DbClient = db) {}

	async insertTransaction(data: NewTransaction) {
		const [transaction] = await this.client.insert(transactions).values(data).returning();

		return transaction;
	}

	async insertEntries(newEntries: NewEntry[]) {
		return this.client.insert(entriesTable).values(newEntries).returning();
	}

	async findRecentByAccountId(accountId: string, limit: number) {
		return this.client
			.select({
				entryId: entriesTable.id,
				amount: entriesTable.amount,
				createdAt: entriesTable.createdAt,
				transactionType: transactions.type,
				fromAccountId: transactions.fromAccountId,
				toAccountId: transactions.toAccountId,
				fromUserId: fromAccounts.userId,
				fromUserName: fromUsers.name,
				toUserId: toAccounts.userId,
				toUserName: toUsers.name,
			})
			.from(entriesTable)
			.innerJoin(transactions, eq(entriesTable.transactionId, transactions.id))
			.leftJoin(fromAccounts, eq(fromAccounts.id, transactions.fromAccountId))
			.leftJoin(fromUsers, eq(fromUsers.id, fromAccounts.userId))
			.leftJoin(toAccounts, eq(toAccounts.id, transactions.toAccountId))
			.leftJoin(toUsers, eq(toUsers.id, toAccounts.userId))
			.where(eq(entriesTable.accountId, accountId))
			.orderBy(desc(entriesTable.createdAt))
			.limit(limit);
	}
}
