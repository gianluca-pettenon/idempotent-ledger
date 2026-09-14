import { db, type DbClient } from "@banking-ledger/db";
import { OperationKind } from "@banking-ledger/shared";
import { withIdempotency } from "@api/features/idempotency";
import {
	AccountNotFoundError,
	InsufficientBalanceError,
	InvalidAmountError,
	OptimisticLockError,
	SameAccountTransferError,
} from "@api/features/ledger/errors/ledger.errors";
import { AccountsRepository } from "@api/features/ledger/repositories/accounts.repository";
import { LedgerRepository } from "@api/features/ledger/repositories/ledger.repository";
import { UsersRepository } from "@api/features/ledger/repositories/users.repository";

const MAX_LOCK_RETRIES = 5;
const RECENT_TRANSACTIONS_LIMIT = 20;

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

	const newBalance = account.balance + direction * params.amount;

	if (newBalance < 0) {
		throw new InsufficientBalanceError(`Account ${account.id} has insufficient balance`);
	}

	const updatedAccounts = await accountsRepository.updateBalanceWithVersion(
		account.id,
		newBalance,
		account.version,
	);

	if (updatedAccounts.length === 0) {
		throw new OptimisticLockError(`Account ${account.id} was updated concurrently`);
	}

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

	return updatedAccounts[0];
}

export async function deposit(params: DepositOrWithdrawParams, client: DbClient = db) {
	if (params.amount <= 0) {
		throw new InvalidAmountError("Amount must be greater than zero");
	}

	return withOptimisticLockRetry(() =>
		withIdempotency(
			OperationKind.Deposit,
			params.idempotencyKey,
			{ userId: params.userId, amount: params.amount },
			(tx) => applyMovement(tx, params, "deposit"),
			client,
		),
	);
}

export async function withdraw(params: DepositOrWithdrawParams, client: DbClient = db) {
	if (params.amount <= 0) {
		throw new InvalidAmountError("Amount must be greater than zero");
	}

	return withOptimisticLockRetry(() =>
		withIdempotency(
			OperationKind.Withdraw,
			params.idempotencyKey,
			{ userId: params.userId, amount: params.amount },
			(tx) => applyMovement(tx, params, "withdraw"),
			client,
		),
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

	const newFromBalance = fromAccount.balance - params.amount;

	if (newFromBalance < 0) {
		throw new InsufficientBalanceError(`Account ${fromAccount.id} has insufficient balance`);
	}

	const newToBalance = toAccount.balance + params.amount;

	const [firstAccount, firstBalance, secondAccount, secondBalance] =
		fromAccount.id < toAccount.id
			? [fromAccount, newFromBalance, toAccount, newToBalance]
			: [toAccount, newToBalance, fromAccount, newFromBalance];

	const [firstUpdated] = await accountsRepository.updateBalanceWithVersion(
		firstAccount.id,
		firstBalance,
		firstAccount.version,
	);

	if (!firstUpdated) {
		throw new OptimisticLockError(`Account ${firstAccount.id} was updated concurrently`);
	}

	const [secondUpdated] = await accountsRepository.updateBalanceWithVersion(
		secondAccount.id,
		secondBalance,
		secondAccount.version,
	);

	if (!secondUpdated) {
		throw new OptimisticLockError(`Account ${secondAccount.id} was updated concurrently`);
	}

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
	if (params.amount <= 0) {
		throw new InvalidAmountError("Amount must be greater than zero");
	}

	if (params.fromUserId === params.toUserId) {
		throw new SameAccountTransferError("Cannot transfer to the same account");
	}

	return withOptimisticLockRetry(() =>
		withIdempotency(
			OperationKind.Transfer,
			params.idempotencyKey,
			{ fromUserId: params.fromUserId, toUserId: params.toUserId, amount: params.amount },
			(tx) => applyTransfer(tx, params),
			client,
		),
	);
}
