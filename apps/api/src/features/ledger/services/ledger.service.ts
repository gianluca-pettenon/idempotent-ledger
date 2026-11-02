import { db, type DbClient } from "@banking-ledger/db";
import { OperationKind } from "@banking-ledger/shared";
import { withIdempotency } from "@api/features/idempotency";
import {
	AccountNotFoundError,
	AlreadyReversedError,
	CannotReverseReversalError,
	CurrencyMismatchError,
	InvalidTransitionError,
	OptimisticLockError,
	SameAccountTransferError,
	SettlementAccountNotFoundError,
	TransactionNotFoundError,
} from "@api/features/ledger/errors";
import { assertPositiveAmount, assertSufficientBalance, entryDelta } from "@api/features/ledger/money";
import { AccountsRepository } from "@api/features/ledger/repositories/accounts.repository";
import { LedgerRepository } from "@api/features/ledger/repositories/ledger.repository";
import { OutboxRepository } from "@api/features/ledger/repositories/outbox.repository";
import { UsersRepository } from "@api/features/ledger/repositories/users.repository";

export { assertPositiveAmount, assertSufficientBalance } from "@api/features/ledger/money";

const MAX_LOCK_RETRIES = 16;
const RECENT_TRANSACTIONS_LIMIT = 20;
const REVERSAL_SCOPE = "reversal";

type AccountRow = NonNullable<Awaited<ReturnType<AccountsRepository["findById"]>>>;

export type AccountView = {
	id: string;
	userId: string | null;
	kind: AccountRow["kind"];
	currency: string;
	balance: bigint;
	version: bigint;
	createdAt: string;
	updatedAt: string;
};

export type TransactionView = {
	id: string;
	type: "deposit" | "withdraw" | "transfer_in" | "transfer_out" | "reversal_in" | "reversal_out";
	amount: bigint;
	createdAt: string;
	counterpartyUserId?: string;
	counterpartyName?: string;
};

export type ReversalView = {
	transactionId: string;
	reversalOfTransactionId: string;
	amount: bigint;
	currency: string;
	status: "posted";
};

type JournalEntry = {
	accountId: string;
	type: "debit" | "credit";
	amount: bigint;
};

type BalanceUpdate = {
	id: string;
	nextBalance: bigint;
	version: bigint;
};

function toAccountView(account: AccountRow): AccountView {
	return {
		id: account.id,
		userId: account.userId,
		kind: account.kind,
		currency: account.currency,
		balance: account.balance,
		version: account.version,
		createdAt: account.createdAt.toISOString(),
		updatedAt: account.updatedAt.toISOString(),
	};
}

function isUniqueViolation(error: unknown) {
	const pending = [error];
	const seen = new Set<unknown>();

	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || typeof current !== "object" || seen.has(current)) continue;

		seen.add(current);

		if ("code" in current && current.code === "23505") return true;
		if ("cause" in current) pending.push(current.cause);
	}

	return false;
}

async function updateBalanceOrThrow(
	accountsRepository: AccountsRepository,
	accountId: string,
	newBalance: bigint,
	expectedVersion: bigint,
) {
	const updated = await accountsRepository.updateBalanceWithVersion(accountId, newBalance, expectedVersion);

	if (!updated) {
		throw new OptimisticLockError(`Account ${accountId} was updated concurrently`);
	}

	return updated;
}

async function applyBalanceUpdates(accountsRepository: AccountsRepository, updates: BalanceUpdate[]) {
	const ordered = [...updates].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
	const updated = new Map<string, AccountRow>();

	for (const update of ordered) {
		updated.set(update.id, await updateBalanceOrThrow(accountsRepository, update.id, update.nextBalance, update.version));
	}

	return updated;
}

function outboxPayload(params: {
	transactionId: string;
	type: string;
	amount: bigint;
	currency: string;
	principalId: string;
	requestId: string;
	reversalOfTransactionId: string | null;
}) {
	return JSON.stringify({
		transactionId: params.transactionId,
		type: params.type,
		amount: params.amount.toString(),
		currency: params.currency,
		status: "posted",
		principalId: params.principalId,
		requestId: params.requestId,
		reversalOfTransactionId: params.reversalOfTransactionId,
	});
}

async function postJournal(
	tx: DbClient,
	params: {
		type: "deposit" | "withdraw" | "transfer" | "reversal";
		amount: bigint;
		currency: string;
		requestId: string;
		idempotencyKey: string | null;
		principalId: string;
		fromAccountId: string;
		toAccountId: string;
		reversalOfTransactionId: string | null;
		entries: JournalEntry[];
		balanceUpdates: BalanceUpdate[];
	},
) {
	const ledgerRepository = new LedgerRepository(tx);
	const transaction = await ledgerRepository.insertTransaction({
		type: params.type,
		status: "pending",
		amount: params.amount,
		currency: params.currency,
		requestId: params.requestId,
		idempotencyKey: params.idempotencyKey,
		principalId: params.principalId,
		fromAccountId: params.fromAccountId,
		toAccountId: params.toAccountId,
		reversalOfTransactionId: params.reversalOfTransactionId,
	});

	await ledgerRepository.insertEntries(
		params.entries.map((entry) => ({
			transactionId: transaction.id,
			accountId: entry.accountId,
			type: entry.type,
			amount: entry.amount,
			currency: params.currency,
		})),
	);

	const updated = await applyBalanceUpdates(new AccountsRepository(tx), params.balanceUpdates);

	await new OutboxRepository(tx).insert({
		aggregateId: transaction.id,
		eventType: "transaction.posted",
		payload: outboxPayload({
			transactionId: transaction.id,
			type: params.type,
			amount: params.amount,
			currency: params.currency,
			principalId: params.principalId,
			requestId: params.requestId,
			reversalOfTransactionId: params.reversalOfTransactionId,
		}),
	});

	const posted = await ledgerRepository.updateStatus(transaction.id, "pending", "posted");

	if (!posted) {
		throw new InvalidTransitionError(`Transaction ${transaction.id} could not be posted`);
	}

	return { transactionId: transaction.id, updated };
}

export async function listUsers(client: DbClient = db) {
	return new UsersRepository(client).findAll();
}

type RecentEntryRow = Awaited<ReturnType<LedgerRepository["findRecentByAccountId"]>>[number];

function toTransactionView(row: RecentEntryRow, accountId: string): TransactionView {
	const base = {
		id: row.entryId,
		amount: row.amount,
		createdAt: row.createdAt.toISOString(),
	};

	if (row.transactionType === "reversal") {
		return {
			...base,
			type: row.entryType === "credit" ? "reversal_in" : "reversal_out",
		};
	}

	if (row.transactionType !== "transfer") {
		return {
			...base,
			type: row.transactionType,
		};
	}

	const isIncoming = row.toAccountId === accountId;

	return {
		...base,
		type: isIncoming ? "transfer_in" : "transfer_out",
		counterpartyUserId: (isIncoming ? row.fromUserId : row.toUserId) ?? undefined,
		counterpartyName: (isIncoming ? row.fromUserName : row.toUserName) ?? undefined,
	};
}

export async function getAccountSnapshot(userId: string, client: DbClient = db) {
	const account = await new AccountsRepository(client).findByUserId(userId);

	if (!account) {
		throw new AccountNotFoundError(`Account not found for user ${userId}`);
	}

	const recentEntries = await new LedgerRepository(client).findRecentByAccountId(account.id, RECENT_TRANSACTIONS_LIMIT);

	return {
		...toAccountView(account),
		transactions: recentEntries.map((row) => toTransactionView(row, account.id)),
	};
}

async function withOptimisticLockRetry<T>(operation: () => Promise<T>): Promise<T> {
	let attempt = 0;

	while (true) {
		attempt += 1;

		try {
			return await operation();
		} catch (error) {
			if (!(error instanceof OptimisticLockError) || attempt >= MAX_LOCK_RETRIES) {
				throw error;
			}
		}
	}
}

type DepositOrWithdrawParams = {
	userId: string;
	amount: bigint;
	requestId: string;
	idempotencyKey: string | null;
};

type MovementKind = "deposit" | "withdraw";

async function applyMovement(tx: DbClient, params: DepositOrWithdrawParams, kind: MovementKind) {
	const accountsRepository = new AccountsRepository(tx);
	const account = await accountsRepository.findByUserId(params.userId);

	if (!account || account.kind !== "customer") {
		throw new AccountNotFoundError(`Account not found for user ${params.userId}`);
	}

	const settlement = await accountsRepository.findSettlement(account.currency);

	if (!settlement) {
		throw new SettlementAccountNotFoundError(`No settlement account for currency ${account.currency}`);
	}

	const customerEntryType = kind === "deposit" ? "credit" : "debit";
	const settlementEntryType = kind === "deposit" ? "debit" : "credit";
	const customerNext = account.balance + entryDelta(account.kind, customerEntryType, params.amount);
	const settlementNext = settlement.balance + entryDelta(settlement.kind, settlementEntryType, params.amount);

	assertSufficientBalance(account.id, customerNext);
	assertSufficientBalance(settlement.id, settlementNext);

	const { transactionId, updated } = await postJournal(tx, {
		type: kind,
		amount: params.amount,
		currency: account.currency,
		requestId: params.requestId,
		idempotencyKey: params.idempotencyKey,
		principalId: params.userId,
		fromAccountId: kind === "deposit" ? settlement.id : account.id,
		toAccountId: kind === "deposit" ? account.id : settlement.id,
		reversalOfTransactionId: null,
		entries: [
			{ accountId: settlement.id, type: settlementEntryType, amount: params.amount },
			{ accountId: account.id, type: customerEntryType, amount: params.amount },
		],
		balanceUpdates: [
			{ id: account.id, nextBalance: customerNext, version: account.version },
			{ id: settlement.id, nextBalance: settlementNext, version: settlement.version },
		],
	});

	const updatedCustomer = updated.get(account.id);

	if (!updatedCustomer) {
		throw new OptimisticLockError(`Account ${account.id} was updated concurrently`);
	}

	return { transactionId, result: toAccountView(updatedCustomer) };
}

function runIdempotentOperation<T>(
	principalId: string,
	scope: string,
	idempotencyKey: string | null,
	requestPayload: unknown,
	operation: (tx: DbClient) => Promise<{ transactionId: string | null; result: T }>,
	client: DbClient,
) {
	return withOptimisticLockRetry(() =>
		withIdempotency(principalId, scope, idempotencyKey, requestPayload, operation, client),
	);
}

export async function deposit(params: DepositOrWithdrawParams, client: DbClient = db) {
	assertPositiveAmount(params.amount);

	return runIdempotentOperation(
		params.userId,
		OperationKind.Deposit,
		params.idempotencyKey,
		{ userId: params.userId, amount: params.amount },
		(tx) => applyMovement(tx, params, "deposit"),
		client,
	);
}

export async function withdraw(params: DepositOrWithdrawParams, client: DbClient = db) {
	assertPositiveAmount(params.amount);

	return runIdempotentOperation(
		params.userId,
		OperationKind.Withdraw,
		params.idempotencyKey,
		{ userId: params.userId, amount: params.amount },
		(tx) => applyMovement(tx, params, "withdraw"),
		client,
	);
}

type TransferParams = {
	fromUserId: string;
	toUserId: string;
	amount: bigint;
	requestId: string;
	idempotencyKey: string | null;
};

async function applyTransfer(tx: DbClient, params: TransferParams) {
	const accountsRepository = new AccountsRepository(tx);
	const [fromAccount, toAccount] = await Promise.all([
		accountsRepository.findByUserId(params.fromUserId),
		accountsRepository.findByUserId(params.toUserId),
	]);

	if (!fromAccount || fromAccount.kind !== "customer") {
		throw new AccountNotFoundError(`Account not found for user ${params.fromUserId}`);
	}

	if (!toAccount || toAccount.kind !== "customer") {
		throw new AccountNotFoundError(`Account not found for user ${params.toUserId}`);
	}

	if (fromAccount.currency !== toAccount.currency) {
		throw new CurrencyMismatchError(
			`Cannot transfer from ${fromAccount.currency} account ${fromAccount.id} to ${toAccount.currency} account ${toAccount.id}`,
		);
	}

	const fromNext = fromAccount.balance + entryDelta("customer", "debit", params.amount);
	const toNext = toAccount.balance + entryDelta("customer", "credit", params.amount);

	assertSufficientBalance(fromAccount.id, fromNext);
	assertSufficientBalance(toAccount.id, toNext);

	const { transactionId, updated } = await postJournal(tx, {
		type: "transfer",
		amount: params.amount,
		currency: fromAccount.currency,
		requestId: params.requestId,
		idempotencyKey: params.idempotencyKey,
		principalId: params.fromUserId,
		fromAccountId: fromAccount.id,
		toAccountId: toAccount.id,
		reversalOfTransactionId: null,
		entries: [
			{ accountId: fromAccount.id, type: "debit", amount: params.amount },
			{ accountId: toAccount.id, type: "credit", amount: params.amount },
		],
		balanceUpdates: [
			{ id: fromAccount.id, nextBalance: fromNext, version: fromAccount.version },
			{ id: toAccount.id, nextBalance: toNext, version: toAccount.version },
		],
	});

	const updatedFrom = updated.get(fromAccount.id);

	if (!updatedFrom) {
		throw new OptimisticLockError(`Account ${fromAccount.id} was updated concurrently`);
	}

	return { transactionId, result: toAccountView(updatedFrom) };
}

export async function transfer(params: TransferParams, client: DbClient = db) {
	assertPositiveAmount(params.amount);

	if (params.fromUserId === params.toUserId) {
		throw new SameAccountTransferError("Cannot transfer to the same account");
	}

	return runIdempotentOperation(
		params.fromUserId,
		OperationKind.Transfer,
		params.idempotencyKey,
		{ fromUserId: params.fromUserId, toUserId: params.toUserId, amount: params.amount },
		(tx) => applyTransfer(tx, params),
		client,
	);
}

type ReverseParams = {
	transactionId: string;
	requestId: string;
	idempotencyKey: string | null;
};

async function applyReversal(tx: DbClient, params: ReverseParams) {
	const ledgerRepository = new LedgerRepository(tx);
	const original = await ledgerRepository.lockById(params.transactionId);

	if (!original) {
		throw new TransactionNotFoundError(`Transaction ${params.transactionId} was not found`);
	}

	if (original.type === "reversal" || original.reversalOfTransactionId) {
		throw new CannotReverseReversalError(`Transaction ${original.id} is a reversal and cannot be reversed`);
	}

	if (original.status === "reversed") {
		throw new AlreadyReversedError(`Transaction ${original.id} was already reversed`);
	}

	if (original.status !== "posted") {
		throw new InvalidTransitionError(`Transaction ${original.id} cannot be reversed from status ${original.status}`);
	}

	const originalEntries = await ledgerRepository.findEntriesByTransactionId(original.id);
	const accountsRepository = new AccountsRepository(tx);
	const accountRows = await accountsRepository.findByIds([...new Set(originalEntries.map((entry) => entry.accountId))]);
	const accountsById = new Map(accountRows.map((account) => [account.id, account]));
	const deltas = new Map<string, bigint>();
	const reversalEntries: JournalEntry[] = originalEntries.map((entry) => {
		const account = accountsById.get(entry.accountId);

		if (!account) {
			throw new AccountNotFoundError(`Account ${entry.accountId} was not found`);
		}

		if (account.currency !== original.currency) {
			throw new CurrencyMismatchError(`Reversal currency ${original.currency} does not match account ${account.id}`);
		}

		const type = entry.type === "debit" ? "credit" : "debit";
		deltas.set(entry.accountId, (deltas.get(entry.accountId) ?? 0n) + entryDelta(account.kind, type, entry.amount));

		return { accountId: entry.accountId, type, amount: entry.amount };
	});

	const balanceUpdates: BalanceUpdate[] = [];

	for (const [accountId, delta] of deltas) {
		const account = accountsById.get(accountId);

		if (!account) {
			throw new AccountNotFoundError(`Account ${accountId} was not found`);
		}

		const nextBalance = account.balance + delta;
		assertSufficientBalance(accountId, nextBalance);
		balanceUpdates.push({ id: accountId, nextBalance, version: account.version });
	}

	const debit = reversalEntries.find((entry) => entry.type === "debit");
	const credit = reversalEntries.find((entry) => entry.type === "credit");

	if (!debit || !credit) {
		throw new InvalidTransitionError(`Transaction ${original.id} cannot be reversed without a debit and a credit`);
	}

	try {
		const posted = await postJournal(tx, {
			type: "reversal",
			amount: original.amount,
			currency: original.currency,
			requestId: params.requestId,
			idempotencyKey: params.idempotencyKey,
			principalId: original.principalId,
			fromAccountId: debit.accountId,
			toAccountId: credit.accountId,
			reversalOfTransactionId: original.id,
			entries: reversalEntries,
			balanceUpdates,
		});

		const reversed = await ledgerRepository.updateStatus(original.id, "posted", "reversed");

		if (!reversed) {
			throw new AlreadyReversedError(`Transaction ${original.id} was already reversed`);
		}

		return {
			transactionId: posted.transactionId,
			result: {
				transactionId: posted.transactionId,
				reversalOfTransactionId: original.id,
				amount: original.amount,
				currency: original.currency,
				status: "posted" as const,
			},
		};
	} catch (error) {
		if (isUniqueViolation(error)) {
			throw new AlreadyReversedError(`Transaction ${original.id} was already reversed`);
		}

		throw error;
	}
}

export async function reverseTransaction(params: ReverseParams, client: DbClient = db) {
	const existing = await new LedgerRepository(client).findById(params.transactionId);

	if (!existing) {
		throw new TransactionNotFoundError(`Transaction ${params.transactionId} was not found`);
	}

	return runIdempotentOperation(
		existing.principalId,
		REVERSAL_SCOPE,
		params.idempotencyKey,
		{ transactionId: params.transactionId },
		(tx) => applyReversal(tx, params),
		client,
	);
}
