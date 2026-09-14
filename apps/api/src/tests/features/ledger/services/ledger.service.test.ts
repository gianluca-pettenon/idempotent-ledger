import { describe, expect, test } from "bun:test";
import { accounts, db, entries, transactions, users } from "@banking-ledger/db";
import { CONCURRENCY_DEMO } from "@banking-ledger/shared";
import { eq } from "drizzle-orm";
import {
	AccountNotFoundError,
	InsufficientBalanceError,
	InvalidAmountError,
	SameAccountTransferError,
} from "@api/features/ledger/errors/ledger.errors";
import { deposit, getAccountSnapshot, transfer, withdraw } from "@api/features/ledger/services/ledger.service";

async function createAccount(initialBalance: number) {
	const [user] = await db.insert(users).values({ name: "Test User" }).returning();
	const [account] = await db.insert(accounts).values({ userId: user.id, balance: initialBalance }).returning();

	return { userId: user.id, accountId: account.id };
}

async function deleteAccount({ userId, accountId }: { userId: string; accountId: string }) {
	await db.delete(entries).where(eq(entries.accountId, accountId));
	await db.delete(transactions).where(eq(transactions.fromAccountId, accountId));
	await db.delete(transactions).where(eq(transactions.toAccountId, accountId));
	await db.delete(accounts).where(eq(accounts.id, accountId));
	await db.delete(users).where(eq(users.id, userId));
}

async function withAccount(initialBalance: number, run: (ctx: { userId: string; accountId: string }) => Promise<void>) {
	const account = await createAccount(initialBalance);

	try {
		await run(account);
	} finally {
		await deleteAccount(account);
	}
}

async function withTwoAccounts(
	balanceA: number,
	balanceB: number,
	run: (ctx: {
		userIdA: string;
		accountIdA: string;
		userIdB: string;
		accountIdB: string;
	}) => Promise<void>,
) {
	const accountA = await createAccount(balanceA);
	const accountB = await createAccount(balanceB);

	try {
		await run({
			userIdA: accountA.userId,
			accountIdA: accountA.accountId,
			userIdB: accountB.userId,
			accountIdB: accountB.accountId,
		});
	} finally {
		await db.delete(entries).where(eq(entries.accountId, accountA.accountId));
		await db.delete(entries).where(eq(entries.accountId, accountB.accountId));
		await db.delete(transactions).where(eq(transactions.fromAccountId, accountA.accountId));
		await db.delete(transactions).where(eq(transactions.toAccountId, accountA.accountId));
		await db.delete(transactions).where(eq(transactions.fromAccountId, accountB.accountId));
		await db.delete(transactions).where(eq(transactions.toAccountId, accountB.accountId));
		await db.delete(accounts).where(eq(accounts.id, accountA.accountId));
		await db.delete(accounts).where(eq(accounts.id, accountB.accountId));
		await db.delete(users).where(eq(users.id, accountA.userId));
		await db.delete(users).where(eq(users.id, accountB.userId));
	}
}

describe("deposit", () => {
	test("increases the balance and creates a matching credit entry", async () => {
		await withAccount(1000, async ({ userId, accountId }) => {
			const { result, outcome } = await deposit({
				userId,
				amount: 500,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			expect(outcome).toBe("processed");
			expect(result.balance).toBe(1500);

			const accountEntries = await db.select().from(entries).where(eq(entries.accountId, accountId));
			expect(accountEntries).toHaveLength(1);
			expect(accountEntries[0]).toMatchObject({ type: "credit", amount: 500 });
		});
	});

	test("throws AccountNotFoundError for an unknown user", async () => {
		await expect(
			deposit({ userId: crypto.randomUUID(), amount: 100, requestId: crypto.randomUUID(), idempotencyKey: null }),
		).rejects.toThrow(AccountNotFoundError);
	});

	test("throws InvalidAmountError for a non-positive amount", async () => {
		await withAccount(1000, async ({ userId }) => {
			await expect(
				deposit({ userId, amount: 0, requestId: crypto.randomUUID(), idempotencyKey: null }),
			).rejects.toThrow(InvalidAmountError);
		});
	});

	test("replays the same result instead of applying twice with the same idempotency key", async () => {
		await withAccount(1000, async ({ userId, accountId }) => {
			const idempotencyKey = crypto.randomUUID();

			const first = await deposit({ userId, amount: 200, requestId: crypto.randomUUID(), idempotencyKey });
			const second = await deposit({ userId, amount: 200, requestId: crypto.randomUUID(), idempotencyKey });

			expect(first.outcome).toBe("processed");
			expect(second.outcome).toBe("duplicate");

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(1200);
		});
	});

	test("keeps the balance correct under N concurrent deposits without an idempotency key", async () => {
		await withAccount(0, async ({ userId, accountId }) => {
			const results = await Promise.all(
				Array.from({ length: CONCURRENCY_DEMO.REQUEST_COUNT }, () =>
					deposit({ userId, amount: 100, requestId: crypto.randomUUID(), idempotencyKey: null }),
				),
			);

			expect(results.every((entry) => entry.outcome === "processed")).toBe(true);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(100 * CONCURRENCY_DEMO.REQUEST_COUNT);

			const accountEntries = await db.select().from(entries).where(eq(entries.accountId, accountId));
			expect(accountEntries).toHaveLength(CONCURRENCY_DEMO.REQUEST_COUNT);
		});
	});

	test("collapses N concurrent deposits with the same idempotency key into a single credit", async () => {
		await withAccount(0, async ({ userId, accountId }) => {
			const idempotencyKey = crypto.randomUUID();

			const results = await Promise.all(
				Array.from({ length: CONCURRENCY_DEMO.REQUEST_COUNT }, () =>
					deposit({ userId, amount: 100, requestId: crypto.randomUUID(), idempotencyKey }),
				),
			);

			const processed = results.filter((entry) => entry.outcome === "processed");
			const duplicated = results.filter((entry) => entry.outcome === "duplicate");

			expect(processed).toHaveLength(1);
			expect(duplicated).toHaveLength(CONCURRENCY_DEMO.REQUEST_COUNT - 1);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(100);
		});
	});
});

describe("withdraw", () => {
	test("decreases the balance and creates a matching debit entry", async () => {
		await withAccount(1000, async ({ userId, accountId }) => {
			const { result } = await withdraw({
				userId,
				amount: 300,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			expect(result.balance).toBe(700);

			const accountEntries = await db.select().from(entries).where(eq(entries.accountId, accountId));
			expect(accountEntries[0]).toMatchObject({ type: "debit", amount: 300 });
		});
	});

	test("throws InsufficientBalanceError when the balance is too low", async () => {
		await withAccount(100, async ({ userId, accountId }) => {
			await expect(
				withdraw({ userId, amount: 500, requestId: crypto.randomUUID(), idempotencyKey: null }),
			).rejects.toThrow(InsufficientBalanceError);

			const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
			expect(account.balance).toBe(100);
		});
	});
});

describe("transfer", () => {
	test("moves the amount from one account to the other with a matching debit/credit pair", async () => {
		await withTwoAccounts(1000, 500, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			const { result, outcome } = await transfer({
				fromUserId: userIdA,
				toUserId: userIdB,
				amount: 300,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			expect(outcome).toBe("processed");
			expect(result.balance).toBe(700);

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
			expect(accountA.balance).toBe(700);
			expect(accountB.balance).toBe(800);

			const debitEntries = await db.select().from(entries).where(eq(entries.accountId, accountIdA));
			const creditEntries = await db.select().from(entries).where(eq(entries.accountId, accountIdB));
			expect(debitEntries).toHaveLength(1);
			expect(debitEntries[0]).toMatchObject({ type: "debit", amount: 300 });
			expect(creditEntries).toHaveLength(1);
			expect(creditEntries[0]).toMatchObject({ type: "credit", amount: 300 });
			expect(debitEntries[0].transactionId).toBe(creditEntries[0].transactionId);
		});
	});

	test("throws SameAccountTransferError when the source and destination are the same user", async () => {
		await withAccount(1000, async ({ userId }) => {
			await expect(
				transfer({
					fromUserId: userId,
					toUserId: userId,
					amount: 100,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(SameAccountTransferError);
		});
	});

	test("throws InsufficientBalanceError without moving any money", async () => {
		await withTwoAccounts(100, 500, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			await expect(
				transfer({
					fromUserId: userIdA,
					toUserId: userIdB,
					amount: 1000,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(InsufficientBalanceError);

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
			expect(accountA.balance).toBe(100);
			expect(accountB.balance).toBe(500);
		});
	});

	test("throws AccountNotFoundError when the destination user has no account", async () => {
		await withAccount(1000, async ({ userId }) => {
			await expect(
				transfer({
					fromUserId: userId,
					toUserId: crypto.randomUUID(),
					amount: 100,
					requestId: crypto.randomUUID(),
					idempotencyKey: null,
				}),
			).rejects.toThrow(AccountNotFoundError);
		});
	});

	test("replays the same result instead of transferring twice with the same idempotency key", async () => {
		await withTwoAccounts(1000, 500, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			const idempotencyKey = crypto.randomUUID();
			const params = { fromUserId: userIdA, toUserId: userIdB, amount: 200, idempotencyKey };

			const first = await transfer({ ...params, requestId: crypto.randomUUID() });
			const second = await transfer({ ...params, requestId: crypto.randomUUID() });

			expect(first.outcome).toBe("processed");
			expect(second.outcome).toBe("duplicate");

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));
			expect(accountA.balance).toBe(800);
			expect(accountB.balance).toBe(700);
		});
	});

	test("does not deadlock on concurrent transfers in opposite directions between the same two accounts", async () => {
		await withTwoAccounts(1000, 1000, async ({ userIdA, accountIdA, userIdB, accountIdB }) => {
			const [aToB, bToA] = await Promise.all([
				transfer({ fromUserId: userIdA, toUserId: userIdB, amount: 300, requestId: crypto.randomUUID(), idempotencyKey: null }),
				transfer({ fromUserId: userIdB, toUserId: userIdA, amount: 100, requestId: crypto.randomUUID(), idempotencyKey: null }),
			]);

			expect(aToB.outcome).toBe("processed");
			expect(bToA.outcome).toBe("processed");

			const [accountA] = await db.select().from(accounts).where(eq(accounts.id, accountIdA));
			const [accountB] = await db.select().from(accounts).where(eq(accounts.id, accountIdB));

			expect(accountA.balance).toBe(800);
			expect(accountB.balance).toBe(1200);
		});
	});
});

describe("getAccountSnapshot", () => {
	test("lists deposit, withdraw, and transfer as seen from each side", async () => {
		await withTwoAccounts(1000, 500, async ({ userIdA, userIdB }) => {
			await deposit({ userId: userIdA, amount: 200, requestId: crypto.randomUUID(), idempotencyKey: null });
			await withdraw({ userId: userIdA, amount: 100, requestId: crypto.randomUUID(), idempotencyKey: null });
			await transfer({
				fromUserId: userIdA,
				toUserId: userIdB,
				amount: 300,
				requestId: crypto.randomUUID(),
				idempotencyKey: null,
			});

			const snapshotA = await getAccountSnapshot(userIdA);
			const snapshotB = await getAccountSnapshot(userIdB);

			expect(snapshotA.transactions.map((entry) => entry.type)).toEqual([
				"transfer_out",
				"withdraw",
				"deposit",
			]);

			const transferOutA = snapshotA.transactions[0];
			expect(transferOutA).toMatchObject({ amount: 300, counterpartyName: "Test User" });

			expect(snapshotB.transactions).toHaveLength(1);
			expect(snapshotB.transactions[0]).toMatchObject({
				type: "transfer_in",
				amount: 300,
				counterpartyName: "Test User",
			});
		});
	});
});
