import { accounts, db, entries, idempotencyKeys, transactions, type DbClient } from "@banking-ledger/db";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";

export type BalanceDiscrepancy = {
	accountId: string;
	storedBalance: bigint;
	calculatedBalance: bigint;
	difference: bigint;
};

export type TransactionDiscrepancy = {
	transactionId: string;
	debitSum: bigint;
	creditSum: bigint;
};

export type ReferenceDiscrepancy = {
	entryId: string;
	problem: "missing_transaction" | "missing_account";
};

export type IdempotencyDiscrepancy = {
	idempotencyId: string;
	problem: "missing_transaction" | "missing_transaction_link" | "principal_mismatch" | "legacy_unlinked";
};

export type ReconciliationReport = {
	ok: boolean;
	accountBalances: BalanceDiscrepancy[];
	transactionBalances: TransactionDiscrepancy[];
	references: ReferenceDiscrepancy[];
	idempotency: IdempotencyDiscrepancy[];
};

const FINANCIAL_SCOPES = ["deposit", "withdraw", "transfer", "reversal"];

const signedEntryAmount = sql`
	CASE
		WHEN ${accounts.kind} = 'customer' AND ${entries.type} = 'credit' THEN ${entries.amount}
		WHEN ${accounts.kind} = 'customer' AND ${entries.type} = 'debit' THEN -${entries.amount}
		WHEN ${accounts.kind} = 'settlement' AND ${entries.type} = 'debit' THEN ${entries.amount}
		WHEN ${accounts.kind} = 'settlement' AND ${entries.type} = 'credit' THEN -${entries.amount}
		ELSE 0
	END
`;

const calculatedBalance = sql`COALESCE(SUM(${signedEntryAmount}), 0)`;
const debitSum = sql`COALESCE(SUM(${entries.amount}) FILTER (WHERE ${entries.type} = 'debit'), 0)`;
const creditSum = sql`COALESCE(SUM(${entries.amount}) FILTER (WHERE ${entries.type} = 'credit'), 0)`;

function asBigint(value: unknown) {
	if (typeof value === "bigint") return value;
	if (typeof value === "number" || typeof value === "string") return BigInt(value);

	throw new Error(`Cannot read monetary value ${String(value)}`);
}

export class ReconciliationRepository {
	constructor(private readonly client: DbClient = db) {}

	async expandAccountIds(accountIds: string[] | undefined) {
		if (!accountIds) return undefined;
		if (accountIds.length === 0) return [];

		const selected = await this.client
			.select({ currency: accounts.currency })
			.from(accounts)
			.where(inArray(accounts.id, accountIds));
		const currencies = [...new Set(selected.map((account) => account.currency))];

		if (currencies.length === 0) return accountIds;

		const settlements = await this.client
			.select({ id: accounts.id })
			.from(accounts)
			.where(and(eq(accounts.kind, "settlement"), inArray(accounts.currency, currencies)));

		return [...new Set([...accountIds, ...settlements.map((account) => account.id)])];
	}

	async findBalanceDiscrepancies(accountIds: string[] | undefined): Promise<BalanceDiscrepancy[]> {
		const rows = await this.client
			.select({
				accountId: accounts.id,
				storedBalance: accounts.balance,
				calculatedBalance,
				difference: sql`${accounts.balance} - ${calculatedBalance}`,
			})
			.from(accounts)
			.leftJoin(entries, eq(entries.accountId, accounts.id))
			.where(accountIds ? inArray(accounts.id, accountIds) : undefined)
			.groupBy(accounts.id, accounts.balance, accounts.kind)
			.having(sql`${accounts.balance} <> ${calculatedBalance}`);

		return rows.map((row) => ({
			accountId: row.accountId,
			storedBalance: asBigint(row.storedBalance),
			calculatedBalance: asBigint(row.calculatedBalance),
			difference: asBigint(row.difference),
		}));
	}

	async findUnbalancedTransactions(accountIds: string[] | undefined): Promise<TransactionDiscrepancy[]> {
		const rows = await this.client
			.select({
				transactionId: transactions.id,
				debitSum,
				creditSum,
			})
			.from(transactions)
			.leftJoin(entries, eq(entries.transactionId, transactions.id))
			.where(
				and(
					inArray(transactions.status, ["posted", "reversed"]),
					accountIds
						? or(inArray(transactions.fromAccountId, accountIds), inArray(transactions.toAccountId, accountIds))
						: undefined,
				),
			)
			.groupBy(transactions.id)
			.having(sql`${debitSum} <> ${creditSum}`);

		return rows.map((row) => ({
			transactionId: row.transactionId,
			debitSum: asBigint(row.debitSum),
			creditSum: asBigint(row.creditSum),
		}));
	}

	async findBrokenReferences(accountIds: string[] | undefined): Promise<ReferenceDiscrepancy[]> {
		const rows = await this.client
			.select({
				entryId: entries.id,
				transactionId: transactions.id,
				accountId: accounts.id,
			})
			.from(entries)
			.leftJoin(transactions, eq(transactions.id, entries.transactionId))
			.leftJoin(accounts, eq(accounts.id, entries.accountId))
			.where(
				and(
					or(isNull(transactions.id), isNull(accounts.id)),
					accountIds ? inArray(entries.accountId, accountIds) : undefined,
				),
			);

		return rows.map((row) => ({
			entryId: row.entryId,
			problem: row.transactionId === null ? "missing_transaction" : "missing_account",
		}));
	}

	async findIdempotencyDiscrepancies(accountIds: string[] | undefined): Promise<IdempotencyDiscrepancy[]> {
		const scopedIds = accountIds ? await this.transactionIdsTouching(accountIds) : undefined;

		if (scopedIds && scopedIds.length === 0) {
			return [];
		}

		const scopedKey = scopedIds ? inArray(idempotencyKeys.transactionId, scopedIds) : undefined;
		const inScope = scopedIds ? inArray(transactions.id, scopedIds) : undefined;

		const [missingTransaction, missingLink, legacyUnlinked, principalMismatch] = await Promise.all([
			this.client
				.select({ idempotencyId: idempotencyKeys.id })
				.from(idempotencyKeys)
				.leftJoin(transactions, eq(transactions.id, idempotencyKeys.transactionId))
				.where(and(isNotNull(idempotencyKeys.transactionId), isNull(transactions.id), scopedKey)),
			accountIds
				? Promise.resolve([])
				: this.client
						.select({ idempotencyId: idempotencyKeys.id })
						.from(idempotencyKeys)
						.where(
							and(
								inArray(idempotencyKeys.scope, FINANCIAL_SCOPES),
								isNotNull(idempotencyKeys.completedAt),
								isNull(idempotencyKeys.transactionId),
								eq(idempotencyKeys.legacyUnlinked, false),
							),
						),
			accountIds
				? Promise.resolve([])
				: this.client
						.select({ idempotencyId: idempotencyKeys.id })
						.from(idempotencyKeys)
						.where(eq(idempotencyKeys.legacyUnlinked, true)),
			this.client
				.select({ idempotencyId: idempotencyKeys.id })
				.from(idempotencyKeys)
				.innerJoin(transactions, eq(transactions.id, idempotencyKeys.transactionId))
				.where(and(ne(idempotencyKeys.principalId, transactions.principalId), inScope)),
		]);

		return [
			...missingTransaction.map((row) => ({ idempotencyId: row.idempotencyId, problem: "missing_transaction" as const })),
			...missingLink.map((row) => ({ idempotencyId: row.idempotencyId, problem: "missing_transaction_link" as const })),
			...legacyUnlinked.map((row) => ({ idempotencyId: row.idempotencyId, problem: "legacy_unlinked" as const })),
			...principalMismatch.map((row) => ({ idempotencyId: row.idempotencyId, problem: "principal_mismatch" as const })),
		];
	}

	async reconcile(accountIds?: string[]): Promise<ReconciliationReport> {
		const ids = await this.expandAccountIds(accountIds);

		if (ids && ids.length === 0) {
			return { ok: true, accountBalances: [], transactionBalances: [], references: [], idempotency: [] };
		}

		const [accountBalances, transactionBalances, references, idempotency] = await Promise.all([
			this.findBalanceDiscrepancies(ids),
			this.findUnbalancedTransactions(ids),
			this.findBrokenReferences(ids),
			this.findIdempotencyDiscrepancies(ids),
		]);

		return {
			ok:
				accountBalances.length === 0 &&
				transactionBalances.length === 0 &&
				references.length === 0 &&
				idempotency.length === 0,
			accountBalances,
			transactionBalances,
			references,
			idempotency,
		};
	}

	private async transactionIdsTouching(accountIds: string[]) {
		const rows = await this.client
			.select({ id: transactions.id })
			.from(transactions)
			.where(or(inArray(transactions.fromAccountId, accountIds), inArray(transactions.toAccountId, accountIds)));

		return rows.map((row) => row.id);
	}
}
