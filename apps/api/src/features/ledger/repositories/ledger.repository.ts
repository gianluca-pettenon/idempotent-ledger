import {
	accounts,
	db,
	entries as entriesTable,
	transactions,
	type DbClient,
	type entryType,
	type transactionStatus,
	type transactionType,
	users,
} from "@banking-ledger/db";
import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

type TransactionType = (typeof transactionType.enumValues)[number];
type TransactionStatus = (typeof transactionStatus.enumValues)[number];

type NewTransaction = {
	type: TransactionType;
	status: TransactionStatus;
	amount: bigint;
	currency: string;
	requestId: string;
	idempotencyKey: string | null;
	principalId: string;
	fromAccountId: string;
	toAccountId: string;
	reversalOfTransactionId: string | null;
};

type NewEntry = {
	transactionId: string;
	accountId: string;
	type: (typeof entryType.enumValues)[number];
	amount: bigint;
	currency: string;
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

	async findById(id: string) {
		const [transaction] = await this.client.select().from(transactions).where(eq(transactions.id, id));

		return transaction;
	}

	async lockById(id: string) {
		const [transaction] = await this.client.select().from(transactions).where(eq(transactions.id, id)).for("update");

		return transaction;
	}

	async findEntriesByTransactionId(transactionId: string) {
		return this.client.select().from(entriesTable).where(eq(entriesTable.transactionId, transactionId));
	}

	async updateStatus(id: string, from: TransactionStatus, to: TransactionStatus) {
		const [transaction] = await this.client
			.update(transactions)
			.set({ status: to })
			.where(and(eq(transactions.id, id), eq(transactions.status, from)))
			.returning();

		return transaction;
	}

	async findRecentByAccountId(accountId: string, limit: number) {
		return this.client
			.select({
				entryId: entriesTable.id,
				entryType: entriesTable.type,
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
