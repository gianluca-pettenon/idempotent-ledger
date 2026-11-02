import { describe, expect, test } from "bun:test";
import { accounts, db, entries, idempotencyKeys, transactions } from "@banking-ledger/db";
import { CONCURRENCY_DEMO } from "@banking-ledger/shared";
import { eq } from "drizzle-orm";
import {
	AccountNotFoundError,
	CurrencyMismatchError,
	InsufficientBalanceError,
	InvalidAmountError,
	SameAccountTransferError,
} from "@api/features/ledger/errors";
import { deposit, getAccountSnapshot, transfer, withdraw } from "@api/features/ledger/services/ledger.service";
import { ReconciliationRepository } from "@api/features/ledger/repositories/reconciliation.repository";
import { createAccount, purgeAccounts } from "@api/tests/fixtures";

async function expectClean(accountIds: string[]) {
	const report = await new ReconciliationRepository().reconcile(accountIds);

	if (!report.ok) {
		throw new Error(
			JSON.stringify(report, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
		);
	}
}

async function withAccount(initialBalance: bigint, run: (ctx: { userId: string; accountId: string }) => Promise<void>) {
	const account = await createAccount(initialBalance);

	try {
		await run(account);
	} finally {
		await purgeAccounts([account]);
	}
}

async function withTwoAccounts(
	balanceA: bigint,
	balanceB: bigint,
	run: (ctx: {
		userIdA: string;
		accountIdA: string;
		userIdB: string;
		accountIdB: string;
	}) => Promise<void>,
	currencyB = "USD",
) {
	const accountA = await createAccount(balanceA);
	const accountB = await createAccount(balanceB, currencyB);

	try {
		await run({
			userIdA: accountA.userId,
			accountIdA: accountA.accountId,
			userIdB: accountB.userId,
			accountIdB: accountB.accountId,
		});
	} finally {
		await purgeAccounts([accountA, accountB]);
	}
}

describe("deposit", () => {
	test("increases the balance and posts a balanced settlement debit plus customer credit", async () => {
		await withAccount(1000n, async ({ userId, accountId }) => {
			const { result, outcome, transactionId } = await deposit({
				userId,
				amount: 500n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			expect(outcome).toBe("processed");
			expect(result.balance).toBe(1500n);
			expect(result.currency).toBe("USD");
			expect(typeof transactionId).toBe("string");

			const accountEntries = await db.select().from(entries).where(eq(entries.accountId, accountId));
			expect(accountEntries.find((entry) => entry.transactionId === transactionId)).toMatchObject({
				type: "credit",
				amount: 500n,
				currency: "USD",
			});

			const journal = await db.select().from(entries).where(eq(entries.transactionId, transactionId!));
			expect(journal).toHaveLength(2);
			expect(journal.find((entry) => entry.type === "debit")?.amount).toBe(500n);
			expect(journal.find((entry) => entry.type === "credit")?.amount).toBe(500n);

			const [transaction] = await db.select().from(transactions).where(eq(transactions.id, transactionId!));
			expect(transaction).toMatchObject({ status: "posted", currency: "USD", type: "deposit" });

			await expectClean([accountId]);
		});
	});

	test("throws AccountNotFoundError for an unknown user", async () => {
		await expect(
			deposit({ userId: crypto.randomUUID(), amount: 100n, requestId: crypto.randomUUID(), idempotencyKey: null }),
		).rejects.toThrow(AccountNotFoundError);
	});

	test("throws InvalidAmountError for a non-positive amount", async () => {
		await withAccount(1000n, async ({ userId }) => {
			await expect(
				deposit({ userId, amount: 0n, requestId: crypto.randomUUID(), idempotencyKey: null }),
			).rejects.toThrow(InvalidAmountError);
		});
	});

	test("replays the same result and keeps the idempotency row linked to the transaction", async () => {
		await withAccount(1000n, async ({ userId, accountId }) => {
			const idempotencyKey = crypto.randomUUID();

			const first = await deposit({ userId, amount: 200n, requestId: crypto.randomUUID(), idempotencyKey });
			const second = await deposit({ userId, amount: 200n, requestId: crypto.randomUUID(), idempotencyKey });

			expect(first.outcome).toBe("processed");
			expect(second.outcome).toBe("duplicate");
			expect(second.transactionId).toBe(first.transactionId);
			expect(second.result.balance).toBe(first.result.balance);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(1200n);

			const [key] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, idempotencyKey));
			expect(key.transactionId).toBe(first.transactionId);
			expect(key.principalId).toBe(userId);

			const [transaction] = await db.select().from(transactions).where(eq(transactions.id, key.transactionId!));
			expect(transaction.principalId).toBe(userId);
			await expectClean([accountId]);
		});
	});

	test("rejects the same key when the payload differs", async () => {
		await withAccount(1000n, async ({ userId, accountId }) => {
			const idempotencyKey = crypto.randomUUID();
			await deposit({ userId, amount: 200n, requestId: crypto.randomUUID(), idempotencyKey });

			await expect(
				deposit({ userId, amount: 300n, requestId: crypto.randomUUID(), idempotencyKey }),
			).rejects.toThrow(/different request payload/);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(1200n);
		});
	});

	test("keeps the balance correct under N concurrent deposits, retrying optimistic conflicts", async () => {
		await withAccount(0n, async ({ userId, accountId }) => {
			const results = await Promise.all(
				Array.from({ length: CONCURRENCY_DEMO.REQUEST_COUNT }, () =>
					deposit({ userId, amount: 100n, requestId: crypto.randomUUID(), idempotencyKey: null }),
				),
			);

			expect(results.every((entry) => entry.outcome === "processed")).toBe(true);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(100n * BigInt(CONCURRENCY_DEMO.REQUEST_COUNT));

			const accountEntries = await db.select().from(entries).where(eq(entries.accountId, accountId));
			expect(accountEntries).toHaveLength(CONCURRENCY_DEMO.REQUEST_COUNT);
			await expectClean([accountId]);
		});
	});

	test("collapses N concurrent deposits with the same idempotency key into a single credit", async () => {
		await withAccount(0n, async ({ userId, accountId }) => {
			const idempotencyKey = crypto.randomUUID();

			const results = await Promise.all(
				Array.from({ length: CONCURRENCY_DEMO.REQUEST_COUNT }, () =>
					deposit({ userId, amount: 100n, requestId: crypto.randomUUID(), idempotencyKey }),
				),
			);

			const processed = results.filter((entry) => entry.outcome === "processed");
			const duplicated = results.filter((entry) => entry.outcome === "duplicate");

			expect(processed).toHaveLength(1);
			expect(duplicated).toHaveLength(CONCURRENCY_DEMO.REQUEST_COUNT - 1);
			expect(duplicated.every((entry) => entry.transactionId === processed[0]?.transactionId)).toBe(true);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(100n);
			await expectClean([accountId]);
		});
	});

	test("lets two principals reuse the same idempotency key without sharing the effect", async () => {
		await withTwoAccounts(0n, 0n, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			const idempotencyKey = "shared-key";

			const [first, second] = await Promise.all([
				deposit({ userId: userIdA, amount: 100n, requestId: crypto.randomUUID(), idempotencyKey }),
				deposit({ userId: userIdB, amount: 100n, requestId: crypto.randomUUID(), idempotencyKey }),
			]);

			expect(first.outcome).toBe("processed");
			expect(second.outcome).toBe("processed");
			expect(first.transactionId).not.toBe(second.transactionId);

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
			expect(accountA.balance).toBe(100n);
			expect(accountB.balance).toBe(100n);
			await expectClean([accountIdA, accountIdB]);
		});
	});
});

describe("withdraw", () => {
	test("decreases the balance and posts a customer debit plus settlement credit", async () => {
		await withAccount(1000n, async ({ userId, accountId }) => {
			const { result, transactionId } = await withdraw({
				userId,
				amount: 300n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			expect(result.balance).toBe(700n);

			const accountEntries = await db.select().from(entries).where(eq(entries.accountId, accountId));
			expect(accountEntries.find((entry) => entry.transactionId === transactionId)).toMatchObject({
				type: "debit",
				amount: 300n,
			});

			const journal = await db.select().from(entries).where(eq(entries.transactionId, transactionId!));
			expect(journal).toHaveLength(2);
			await expectClean([accountId]);
		});
	});

	test("throws InsufficientBalanceError when the balance is too low", async () => {
		await withAccount(100n, async ({ userId, accountId }) => {
			await expect(
				withdraw({ userId, amount: 500n, requestId: crypto.randomUUID(), idempotencyKey: null }),
			).rejects.toThrow(InsufficientBalanceError);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(100n);
			await expectClean([accountId]);
		});
	});

	test("keeps the balance correct under concurrent withdrawals", async () => {
		await withAccount(1000n, async ({ userId, accountId }) => {
			const results = await Promise.all(
				Array.from({ length: CONCURRENCY_DEMO.REQUEST_COUNT }, () =>
					withdraw({ userId, amount: 100n, requestId: crypto.randomUUID(), idempotencyKey: null }),
				),
			);

			expect(results.every((entry) => entry.outcome === "processed")).toBe(true);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(600n);
			await expectClean([accountId]);
		});
	});
});

describe("transfer", () => {
	test("moves the amount with a matching debit/credit pair and does not touch settlement", async () => {
		await withTwoAccounts(1000n, 500n, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			const { result, outcome, transactionId } = await transfer({
				fromUserId: userIdA,
				toUserId: userIdB,
				amount: 300n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			expect(outcome).toBe("processed");
			expect(result.balance).toBe(700n);

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
			expect(accountA.balance).toBe(700n);
			expect(accountB.balance).toBe(800n);

			const journal = await db.select().from(entries).where(eq(entries.transactionId, transactionId!));
			expect(journal).toHaveLength(2);
			expect(journal.find((entry) => entry.accountId === accountIdA)).toMatchObject({ type: "debit", amount: 300n });
			expect(journal.find((entry) => entry.accountId === accountIdB)).toMatchObject({ type: "credit", amount: 300n });
			await expectClean([accountIdA, accountIdB]);
		});
	});

	test("throws SameAccountTransferError when the source and destination are the same user", async () => {
		await withAccount(1000n, async ({ userId }) => {
			await expect(
				transfer({
					fromUserId: userId,
					toUserId: userId,
					amount: 100n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(SameAccountTransferError);
		});
	});

	test("throws InsufficientBalanceError without moving any money", async () => {
		await withTwoAccounts(100n, 500n, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			await expect(
				transfer({
					fromUserId: userIdA,
					toUserId: userIdB,
					amount: 1000n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(InsufficientBalanceError);

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
			expect(accountA.balance).toBe(100n);
			expect(accountB.balance).toBe(500n);
		});
	});

	test("throws AccountNotFoundError when the destination user has no account", async () => {
		await withAccount(1000n, async ({ userId }) => {
			await expect(
				transfer({
					fromUserId: userId,
					toUserId: crypto.randomUUID(),
					amount: 100n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(AccountNotFoundError);
		});
	});

	test("throws CurrencyMismatchError for accounts in different currencies", async () => {
		await withTwoAccounts(
			1000n,
			500n,
			async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
				await expect(
					transfer({
						fromUserId: userIdA,
						toUserId: userIdB,
						amount: 100n,
						requestId: crypto.randomUUID(),
						idempotencyKey: null,
					}),
				).rejects.toThrow(CurrencyMismatchError);

				const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
				const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
				expect(accountA.balance).toBe(1000n);
				expect(accountB.balance).toBe(500n);
			},
			"EUR",
		);
	});

	test("replays the same result instead of transferring twice with the same idempotency key", async () => {
		await withTwoAccounts(1000n, 500n, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			const idempotencyKey = crypto.randomUUID();
			const params = { fromUserId: userIdA, toUserId: userIdB, amount: 200n, idempotencyKey };

			const first = await transfer({ ...params, requestId: crypto.randomUUID() });
			const second = await transfer({ ...params, requestId: crypto.randomUUID() });

			expect(first.outcome).toBe("processed");
			expect(second.outcome).toBe("duplicate");
			expect(second.transactionId).toBe(first.transactionId);

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
			expect(accountA.balance).toBe(800n);
			expect(accountB.balance).toBe(700n);
			await expectClean([accountIdA, accountIdB]);
		});
	});

	test("does not deadlock on concurrent transfers in opposite directions between the same two accounts", async () => {
		await withTwoAccounts(1000n, 1000n, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			const [aToB, bToA] = await Promise.all([
				transfer({
					fromUserId: userIdA,
					toUserId: userIdB,
					amount: 300n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
				transfer({
					fromUserId: userIdB,
					toUserId: userIdA,
					amount: 100n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			]);

			expect(aToB.outcome).toBe("processed");
			expect(bToA.outcome).toBe("processed");

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));

			expect(accountA.balance).toBe(800n);
			expect(accountB.balance).toBe(1200n);
			await expectClean([accountIdA, accountIdB]);
		});
	});

	test("does not deadlock when several accounts transfer in opposite directions at once", async () => {
		const accountA = await createAccount(5000n);
		const accountB = await createAccount(5000n);
		const accountC = await createAccount(5000n);

		try {
			const results = await Promise.all([
				transfer({
					fromUserId: accountA.userId,
					toUserId: accountB.userId,
					amount: 100n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
				transfer({
					fromUserId: accountB.userId,
					toUserId: accountA.userId,
					amount: 50n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
				transfer({
					fromUserId: accountA.userId,
					toUserId: accountC.userId,
					amount: 80n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
				transfer({
					fromUserId: accountC.userId,
					toUserId: accountA.userId,
					amount: 30n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
				transfer({
					fromUserId: accountB.userId,
					toUserId: accountC.userId,
					amount: 20n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
				transfer({
					fromUserId: accountC.userId,
					toUserId: accountB.userId,
					amount: 10n,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			]);

			expect(results.every((entry) => entry.outcome === "processed")).toBe(true);

			const [rowA] = await db.select().from(accounts).where(eq(accounts.id, accountA.accountId));
			const [rowB] = await db.select().from(accounts).where(eq(accounts.id, accountB.accountId));
			const [rowC] = await db.select().from(accounts).where(eq(accounts.id, accountC.accountId));

			expect(rowA.balance + rowB.balance + rowC.balance).toBe(15000n);
			await expectClean([accountA.accountId, accountB.accountId, accountC.accountId]);
		} finally {
			await purgeAccounts([accountA, accountB, accountC]);
		}
	});
});

describe("getAccountSnapshot", () => {
	test("lists deposit, withdraw, and transfer as seen from each side", async () => {
		await withTwoAccounts(1000n, 500n, async ({ userIdA, userIdB }) => {
			await deposit({ userId: userIdA, amount: 200n, requestId: crypto.randomUUID(), idempotencyKey: null });
			await withdraw({ userId: userIdA, amount: 100n, requestId: crypto.randomUUID(), idempotencyKey: null });
			await transfer({
				fromUserId: userIdA,
				toUserId: userIdB,
				amount: 300n,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			const snapshotA = await getAccountSnapshot(userIdA);
			const snapshotB = await getAccountSnapshot(userIdB);

			expect(snapshotA.transactions.map((entry) => entry.type)).toEqual([
				"transfer_out",
				"withdraw",
				"deposit",
				"deposit",
			]);

			const transferOutA = snapshotA.transactions[0];
			expect(transferOutA).toMatchObject({ amount: 300n, counterpartyName: "Test User" });

			expect(snapshotB.transactions.find((entry) => entry.type === "transfer_in")).toMatchObject({
				amount: 300n,
				counterpartyName: "Test User",
			});
		});
	});
});
