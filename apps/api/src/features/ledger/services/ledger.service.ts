import { db, type DbClient } from "@banking-ledger/db";
import { OperationKind } from "@banking-ledger/shared";
import { withIdempotency } from "@api/features/idempotency";
import {
	AccountNotFoundError,
	InsufficientBalanceError,
	InvalidAmountError,
	OptimisticLockError,
	SameAccountTransferError,
} from "@api/features/ledger/errors";
import { AccountsRepository } from "@api/features/ledger/repositories/accounts.repository";
import { LedgerRepository } from "@api/features/ledger/repositories/ledger.repository";
import { UsersRepository } from "@api/features/ledger/repositories/users.repository";

const MAX_LOCK_RETRIES = 5;
const RECENT_TRANSACTIONS_LIMIT = 20;

export function assertPositiveAmount(amount: number) {
	if (amount <= 0) {
		throw new InvalidAmountError("Amount must be greater than zero");
	}
}

export function calculateNewBalance(currentBalance: number, amount: number, direction: 1 | -1) {
	return currentBalance + direction * amount;
}

export function assertSufficientBalance(accountId: string, newBalance: number) {
	if (newBalance < 0) {
		throw new InsufficientBalanceError(`Account ${accountId} has insufficient balance`);
	}
}

async function updateBalanceOrThrow(
	accountsRepository: AccountsRepository,
	accountId: string,
	newBalance: number,
	expectedVersion: number,
) {
	const updated = await accountsRepository.updateBalanceWithVersion(accountId, newBalance, expectedVersion);

	if (!updated) {
		throw new OptimisticLockError(`Account ${accountId} was updated concurrently`);
	}

	return updated;
}

export async function listUsers(client: DbClient = db) {
	return new UsersRepository(client).findAll();
}

type RecentEntryRow = Awaited<ReturnType<LedgerRepository["findRecentByAccountId"]>>[number];

function toTransactionView(row: RecentEntryRow, accountId: string) {
	if (row.transactionType !== "transfer") {
		return {
			id: row.entryId,
			type: row.transactionType,
			amount: row.amount,
			createdAt: row.createdAt.toISOString(),
		};
	}

	const isIncoming = row.toAccountId === accountId;

	return {
		id: row.entryId,
		type: isIncoming ? ("transfer_in" as const) : ("transfer_out" as const),
		amount: row.amount,
		createdAt: row.createdAt.toISOString(),
		counterpartyUserId: (isIncoming ? row.fromUserId : row.toUserId) ?? undefined,
		counterpartyName: (isIncoming ? row.fromUserName : row.toUserName) ?? undefined,
	};
}

export async function getAccountSnapshot(userId: string, client: DbClient = db) {
	const account = await new AccountsRepository(client).findByUserId(userId);

	if (!account) {
		throw new AccountNotFoundError(`Account not found for user ${userId}`);
	}

	const recentEntries = await new LedgerRepository(client).findRecentByAccountId(
		account.id,
		RECENT_TRANSACTIONS_LIMIT,
	);

	return {
		...account,
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
	amount: number;
	requestId: string;
	idempotencyKey: string | null;
};

type MovementKind = "deposit" | "withdraw";

async function applyMovement(tx: DbClient, params: DepositOrWithdrawParams, kind: MovementKind) {
	const direction = kind === "deposit" ? 1 : -1;
	const accountsRepository = new AccountsRepository(tx);
	const account = await accountsRepository.findByUserId(params.userId);

	if (!account) {
		throw new AccountNotFoundError(`Account not found for user ${params.userId}`);
	}

	const newBalance = calculateNewBalance(account.balance, params.amount, direction);
	assertSufficientBalance(account.id, newBalance);

	const updatedAccount = await updateBalanceOrThrow(accountsRepository, account.id, newBalance, account.version);

	const ledgerRepository = new LedgerRepository(tx);
	const transaction = await ledgerRepository.insertTransaction({
		type: kind,
		amount: params.amount,
		requestId: params.requestId,
		idempotencyKey: params.idempotencyKey,
		fromAccountId: kind === "withdraw" ? account.id : null,
		toAccountId: kind === "deposit" ? account.id : null,
	});

	await ledgerRepository.insertEntries([
		{
			transactionId: transaction.id,
			accountId: account.id,
			type: kind === "deposit" ? "credit" : "debit",
			amount: params.amount,
		},
	]);

	return updatedAccount;
}

function runIdempotentOperation<T>(
	scope: string,
	idempotencyKey: string | null,
	requestPayload: unknown,
	operation: (tx: DbClient) => Promise<T>,
	client: DbClient,
) {
	return withOptimisticLockRetry(() => withIdempotency(scope, idempotencyKey, requestPayload, operation, client));
}

export async function deposit(params: DepositOrWithdrawParams, client: DbClient = db) {
	assertPositiveAmount(params.amount);

	return runIdempotentOperation(
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
	amount: number;
	requestId: string;
	idempotencyKey: string | null;
};

async function applyTransfer(tx: DbClient, params: TransferParams) {
	const accountsRepository = new AccountsRepository(tx);
	const [fromAccount, toAccount] = await Promise.all([
		accountsRepository.findByUserId(params.fromUserId),
		accountsRepository.findByUserId(params.toUserId),
	]);

	if (!fromAccount) {
		throw new AccountNotFoundError(`Account not found for user ${params.fromUserId}`);
	}

	if (!toAccount) {
		throw new AccountNotFoundError(`Account not found for user ${params.toUserId}`);
	}

	const newFromBalance = calculateNewBalance(fromAccount.balance, params.amount, -1);
	assertSufficientBalance(fromAccount.id, newFromBalance);

	const newToBalance = calculateNewBalance(toAccount.balance, params.amount, 1);

	// Update accounts in a stable order (lowest id first) so concurrent transfers between
	// the same two accounts in opposite directions can't deadlock on row locks.
	const [firstAccount, firstBalance, secondAccount, secondBalance] =
		fromAccount.id < toAccount.id
			? [fromAccount, newFromBalance, toAccount, newToBalance]
			: [toAccount, newToBalance, fromAccount, newFromBalance];

	const firstUpdated = await updateBalanceOrThrow(
		accountsRepository,
		firstAccount.id,
		firstBalance,
		firstAccount.version,
	);
	const secondUpdated = await updateBalanceOrThrow(
		accountsRepository,
		secondAccount.id,
		secondBalance,
		secondAccount.version,
	);

	const updatedFromAccount = firstAccount.id === fromAccount.id ? firstUpdated : secondUpdated;

	const ledgerRepository = new LedgerRepository(tx);
	const transaction = await ledgerRepository.insertTransaction({
		type: "transfer",
		amount: params.amount,
		requestId: params.requestId,
		idempotencyKey: params.idempotencyKey,
		fromAccountId: fromAccount.id,
		toAccountId: toAccount.id,
	});

	await ledgerRepository.insertEntries([
		{ transactionId: transaction.id, accountId: fromAccount.id, type: "debit", amount: params.amount },
		{ transactionId: transaction.id, accountId: toAccount.id, type: "credit", amount: params.amount },
	]);

	return updatedFromAccount;
}

export async function transfer(params: TransferParams, client: DbClient = db) {
	assertPositiveAmount(params.amount);

	if (params.fromUserId === params.toUserId) {
		throw new SameAccountTransferError("Cannot transfer to the same account");
	}

	return runIdempotentOperation(
		OperationKind.Transfer,
		params.idempotencyKey,
		{ fromUserId: params.fromUserId, toUserId: params.toUserId, amount: params.amount },
		(tx) => applyTransfer(tx, params),
		client,
	);
}
