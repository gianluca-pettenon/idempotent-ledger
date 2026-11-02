import { accounts, db, entries, idempotencyKeys, outboxEvents, transactions, users, type DbClient } from "@banking-ledger/db";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { entryDelta } from "@api/features/ledger/money";
import { deposit } from "@api/features/ledger/services/ledger.service";

export async function createAccount(initialBalance: bigint, currency = "USD") {
	await ensureSettlement(currency);

	const [user] = await db.insert(users).values({ name: "Test User" }).returning();
	const [account] = await db
		.insert(accounts)
		.values({ userId: user.id, balance: 0n, currency, kind: "customer" })
		.returning();

	if (initialBalance > 0n) {
		await deposit({
			userId: user.id,
			amount: initialBalance,
			requestId: crypto.randomUUID(),
			idempotencyKey: null,
		});
	}

	return { userId: user.id, accountId: account.id, currency };
}

export async function ensureSettlement(currency: string) {
	const [existing] = await db
		.select()
		.from(accounts)
		.where(and(eq(accounts.kind, "settlement"), eq(accounts.currency, currency)));

	if (existing) return existing;

	try {
		const [created] = await db
			.insert(accounts)
			.values({ userId: null, kind: "settlement", currency, balance: 0n })
			.returning();

		return created;
	} catch {
		const [retry] = await db
			.select()
			.from(accounts)
			.where(and(eq(accounts.kind, "settlement"), eq(accounts.currency, currency)));

		if (!retry) throw new Error(`Settlement account for ${currency} could not be created`);

		return retry;
	}
}

export async function purgeAccounts(contexts: { userId: string; accountId: string }[]) {
	if (contexts.length === 0) return;

	const accountIds = contexts.map((context) => context.accountId);
	const userIds = contexts.map((context) => context.userId);

	await db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('ledger.maintenance', 'on', true)`);

		const related = await tx
			.select({ id: transactions.id })
			.from(transactions)
			.where(or(inArray(transactions.fromAccountId, accountIds), inArray(transactions.toAccountId, accountIds)));
		const ids = related.map((row) => row.id);

		if (ids.length > 0) {
			await tx.delete(outboxEvents).where(inArray(outboxEvents.aggregateId, ids));
			await tx.delete(idempotencyKeys).where(inArray(idempotencyKeys.transactionId, ids));
			await tx.delete(entries).where(inArray(entries.transactionId, ids));
			await tx
				.delete(transactions)
				.where(and(inArray(transactions.id, ids), isNotNull(transactions.reversalOfTransactionId)));
			await tx.delete(transactions).where(inArray(transactions.id, ids));
		}

		await tx.delete(accounts).where(inArray(accounts.id, accountIds));
		await tx.delete(users).where(inArray(users.id, userIds));
		await recomputeSettlementBalances(tx);
	});
}

async function recomputeSettlementBalances(tx: DbClient) {
	const settlements = await tx.select().from(accounts).where(eq(accounts.kind, "settlement"));

	for (const settlement of settlements) {
		const journal = await tx.select().from(entries).where(eq(entries.accountId, settlement.id));
		const balance = journal.reduce(
			(total, entry) => total + entryDelta(settlement.kind, entry.type, entry.amount),
			0n,
		);

		if (balance !== settlement.balance) {
			await tx.update(accounts).set({ balance }).where(eq(accounts.id, settlement.id));
		}
	}
}
