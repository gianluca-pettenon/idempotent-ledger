import { describe, expect, test } from "bun:test";
import { accounts, db, entries, outboxEvents, transactions } from "@banking-ledger/db";
import { and, eq } from "drizzle-orm";
import { AlreadyReversedError, CannotReverseReversalError, InsufficientBalanceError } from "@api/features/ledger/errors";
import { deposit, reverseTransaction, withdraw } from "@api/features/ledger";
import { LedgerRepository } from "@api/features/ledger/repositories/ledger.repository";
import { OutboxRepository } from "@api/features/ledger/repositories/outbox.repository";
import { ReconciliationRepository } from "@api/features/ledger/repositories/reconciliation.repository";
import { createAccount, purgeAccounts } from "@api/tests/fixtures";

function errorText(error: unknown) {
	const parts: string[] = [];
	const seen = new Set<unknown>();
	let current = error;

	while (current && typeof current === "object" && !seen.has(current)) {
		seen.add(current);
		if ("message" in current && typeof current.message === "string") parts.push(current.message);
		current = "cause" in current ? current.cause : undefined;
	}

	return parts.join("\n");
}

async function expectRejected(run: () => Promise<unknown>, pattern: RegExp) {
	try {
		await run();
	} catch (error) {
		expect(errorText(error)).toMatch(pattern);
		return;
	}

	throw new Error(`expected a rejection matching ${pattern}`);
}

async function expectClean(accountIds: string[]) {
	const report = await new ReconciliationRepository().reconcile(accountIds);

	if (!report.ok) {
		throw new Error(JSON.stringify(report, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
	}
}

describe("reversal", () => {
	test("posts a new balanced transaction and leaves the original entries unchanged", async () => {
		const account = await createAccount(1000n);

		try {
			const deposited = await deposit({
				userId: account.userId,
				amount: 400n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});
			const originalEntries = await db.select().from(entries).where(eq(entries.transactionId, deposited.transactionId!));

			const reversal = await reverseTransaction({
				transactionId: deposited.transactionId!,
				requestId: crypto.randomUUID(),
				idempotencyKey: crypto.randomUUID(),
			});

			expect(reversal.outcome).toBe("processed");
			expect(reversal.result).toMatchObject({
				reversalOfTransactionId: deposited.transactionId,
				amount: 400n,
				currency: "USD",
				status: "posted",
			});

			const unchanged = await db.select().from(entries).where(eq(entries.transactionId, deposited.transactionId!));
			expect(unchanged).toEqual(originalEntries);

			const reversalEntries = await db.select().from(entries).where(eq(entries.transactionId, reversal.transactionId!));
			expect(reversalEntries).toHaveLength(2);

			const [original] = await db.select().from(transactions).where(eq(transactions.id, deposited.transactionId!));
			const [reversing] = await db.select().from(transactions).where(eq(transactions.id, reversal.transactionId!));
			expect(original.status).toBe("reversed");
			expect(reversing).toMatchObject({ type: "reversal", status: "posted", reversalOfTransactionId: original.id });

			const [customer] = await db.select().from(accounts).where(eq(accounts.id, account.accountId));
			expect(customer.balance).toBe(1000n);
			await expectClean([account.accountId]);
		} finally {
			await purgeAccounts([account]);
		}
	});

	test("rejects a second reversal and a reversal of a reversal", async () => {
		const account = await createAccount(500n);

		try {
			const deposited = await deposit({
				userId: account.userId,
				amount: 100n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});
			const reversal = await reverseTransaction({
				transactionId: deposited.transactionId!,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			await expect(
				reverseTransaction({
					transactionId: deposited.transactionId!,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(AlreadyReversedError);

			await expect(
				reverseTransaction({
					transactionId: reversal.transactionId!,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(CannotReverseReversalError);

			const [customer] = await db.select().from(accounts).where(eq(accounts.id, account.accountId));
			expect(customer.balance).toBe(500n);
			await expectClean([account.accountId]);
		} finally {
			await purgeAccounts([account]);
		}
	});

	test("rejects a reversal when the customer no longer has the funds", async () => {
		const account = await createAccount(0n);

		try {
			const deposited = await deposit({
				userId: account.userId,
				amount: 200n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});
			await withdraw({
				userId: account.userId,
				amount: 200n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			await expect(
				reverseTransaction({
					transactionId: deposited.transactionId!,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(InsufficientBalanceError);

			const [original] = await db.select().from(transactions).where(eq(transactions.id, deposited.transactionId!));
			expect(original.status).toBe("posted");
			await expectClean([account.accountId]);
		} finally {
			await purgeAccounts([account]);
		}
	});
});

describe("append-only ledger", () => {
	test("rejects updates and deletes of posted entries and transactions", async () => {
		const account = await createAccount(0n);

		try {
			const deposited = await deposit({
				userId: account.userId,
				amount: 50n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});
			const [entry] = await db.select().from(entries).where(eq(entries.transactionId, deposited.transactionId!));

			await expectRejected(() => db.delete(entries).where(eq(entries.id, entry.id)), /append-only/);
			await expectRejected(() => db.update(entries).set({ amount: 1n }).where(eq(entries.id, entry.id)), /append-only/);
			await expectRejected(() => db.delete(transactions).where(eq(transactions.id, deposited.transactionId!)), /append-only/);
			await expectRejected(
				() => db.update(transactions).set({ amount: 1n }).where(eq(transactions.id, deposited.transactionId!)),
				/append-only/,
			);
			await expectRejected(
				() => db.update(transactions).set({ status: "failed" }).where(eq(transactions.id, deposited.transactionId!)),
				/invalid transaction status transition/,
			);
		} finally {
			await purgeAccounts([account]);
		}
	});
});

describe("balanced posting", () => {
	test("rolls back an unbalanced transaction instead of leaving it posted", async () => {
		const source = await createAccount(1000n);
		const destination = await createAccount(0n);
		const requestId = crypto.randomUUID();

		try {
			await expect(
				db.transaction(async (tx) => {
					const ledger = new LedgerRepository(tx);
					const transaction = await ledger.insertTransaction({
						type: "transfer",
						status: "pending",
						amount: 100n,
						currency: "USD",
						requestId,
						idempotencyKey: null,
						principalId: source.userId,
						fromAccountId: source.accountId,
						toAccountId: destination.accountId,
						reversalOfTransactionId: null,
					});

					await ledger.insertEntries([
						{
							transactionId: transaction.id,
							accountId: source.accountId,
							type: "debit",
							amount: 100n,
							currency: "USD",
						},
					]);
					await ledger.updateStatus(transaction.id, "pending", "posted");
				}),
			).rejects.toThrow(/unbalanced transaction/);

			const rows = await db.select().from(transactions).where(eq(transactions.requestId, requestId));
			expect(rows).toHaveLength(0);
			await expectClean([source.accountId, destination.accountId]);
		} finally {
			await purgeAccounts([source, destination]);
		}
	});

	test("rolls back every entry when the second leg fails", async () => {
		const account = await createAccount(0n);
		const requestId = crypto.randomUUID();

		try {
			const [settlement] = await db
				.select()
				.from(accounts)
				.where(and(eq(accounts.kind, "settlement"), eq(accounts.currency, "USD")));

			await expect(
				db.transaction(async (tx) => {
					const ledger = new LedgerRepository(tx);
					const transaction = await ledger.insertTransaction({
						type: "deposit",
						status: "pending",
						amount: 80n,
						currency: "USD",
						requestId,
						idempotencyKey: null,
						principalId: account.userId,
						fromAccountId: settlement.id,
						toAccountId: account.accountId,
						reversalOfTransactionId: null,
					});

					await ledger.insertEntries([
						{
							transactionId: transaction.id,
							accountId: settlement.id,
							type: "debit",
							amount: 80n,
							currency: "USD",
						},
					]);
					throw new Error("second entry failed");
				}),
			).rejects.toThrow("second entry failed");

			const journal = await db.select().from(transactions).where(eq(transactions.requestId, requestId));
			expect(journal).toHaveLength(0);
			const accountEntries = await db.select().from(entries).where(eq(entries.accountId, account.accountId));
			expect(accountEntries).toHaveLength(0);
		} finally {
			await purgeAccounts([account]);
		}
	});

	test("rejects an invalid status transition on a posted transaction", async () => {
		const account = await createAccount(0n);

		try {
			const deposited = await deposit({
				userId: account.userId,
				amount: 40n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			await expectRejected(
				() => db.update(transactions).set({ status: "pending" }).where(eq(transactions.id, deposited.transactionId!)),
				/invalid transaction status transition/,
			);

			const [transaction] = await db.select().from(transactions).where(eq(transactions.id, deposited.transactionId!));
			expect(transaction.status).toBe("posted");
		} finally {
			await purgeAccounts([account]);
		}
	});
});

describe("reconciliation", () => {
	test("reports a stored balance drift and does not correct it", async () => {
		const account = await createAccount(0n);

		try {
			await deposit({
				userId: account.userId,
				amount: 75n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});
			await db.update(accounts).set({ balance: 76n }).where(eq(accounts.id, account.accountId));

			const drifted = await new ReconciliationRepository().reconcile([account.accountId]);
			expect(drifted.ok).toBe(false);
			expect(drifted.accountBalances).toEqual([
				{
					accountId: account.accountId,
					storedBalance: 76n,
					calculatedBalance: 75n,
					difference: 1n,
				},
			]);

			const [stillDrifted] = await db.select().from(accounts).where(eq(accounts.id, account.accountId));
			expect(stillDrifted.balance).toBe(76n);

			await db.update(accounts).set({ balance: 75n }).where(eq(accounts.id, account.accountId));
			await expectClean([account.accountId]);
		} finally {
			await purgeAccounts([account]);
		}
	});
});

describe("outbox", () => {
	test("writes the event in the same transaction as the posting and can mark it published", async () => {
		const account = await createAccount(0n);

		try {
			const deposited = await deposit({
				userId: account.userId,
				amount: 25n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});
			const events = await db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, deposited.transactionId!));

			expect(events).toHaveLength(1);
			expect(events[0]?.eventType).toBe("transaction.posted");
			expect(events[0]?.publishedAt).toBeNull();
			expect(JSON.parse(events[0]?.payload ?? "{}")).toMatchObject({
				transactionId: deposited.transactionId,
				amount: "25",
				currency: "USD",
				status: "posted",
			});

			const published = await new OutboxRepository(db).markPublished(events[0]!.id);
			expect(published?.publishedAt).toBeInstanceOf(Date);
		} finally {
			await purgeAccounts([account]);
		}
	});
});
