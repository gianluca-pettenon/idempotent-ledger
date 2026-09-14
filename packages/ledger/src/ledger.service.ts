import { db, type DbClient } from "@banking-ledger/db";
import { withIdempotency } from "@banking-ledger/idempotency";
import { OperationKind } from "@banking-ledger/shared";
import {
	AccountNotFoundError,
	InsufficientBalanceError,
	InvalidAmountError,
	OptimisticLockError,
	SameAccountTransferError,
} from "./errors";
import { AccountsRepository } from "./repositories/accounts.repository";
import { LedgerRepository } from "./repositories/ledger.repository";
import { UsersRepository } from "./repositories/users.repository";

const MAX_LOCK_RETRIES = 5;
const RECENT_TRANSACTIONS_LIMIT = 20;

export async function listUsers(client: DbClient = db) {
	return new UsersRepository(client).findAll();
}

type RecentEntryRow = Awaited<ReturnType<LedgerRepository["findRecentByAccountId"]>>[number];

// O front (apps/web/src/app/types.ts) enxerga transfer pelo lado de quem está olhando:
// "transfer_in" pra quem recebeu, "transfer_out" pra quem enviou — nunca "transfer" cru.
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

// Reexecuta a operação inteira (idempotência incluída) quando ela falha por conflito de
// versão. Como reserva + operação de negócio + conclusão da idempotency key acontecem na
// mesma db.transaction, um OptimisticLockError dá rollback em tudo — a tentativa seguinte
// parte limpa, sem nenhuma chave "presa" reservada sem efeito aplicado.
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

// userId, não accountId: é assim que a rota (/accounts/:userId/transactions) e o
// frontend (lib/api.ts) identificam a conta — a resolução userId -> account acontece
// aqui dentro, via AccountsRepository.findByUserId.
type DepositOrWithdrawParams = {
	userId: string;
	amount: number;
	requestId: string;
	idempotencyKey: string | null;
};

type MovementKind = "deposit" | "withdraw";

// Deposit/withdraw só têm uma conta real envolvida (a outra ponta é "o mundo de fora",
// que este schema não modela como conta) — por isso geram só 1 entry, espelhando
// fromAccountId/toAccountId nullable de `transactions`. Transfer (fase 5) é quem gera
// o par débito+crédito de verdade, entre duas contas.
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

// Retorno espelha IdempotencyResult<Account>: a rota usa `outcome` direto em `meta.outcome`
// (é o que o "Concurrency lab" do frontend lê pra colorir processed/duplicate/failed).
export async function deposit(params: DepositOrWithdrawParams, client: DbClient = db) {
	if (params.amount <= 0) {
		throw new InvalidAmountError("Amount must be greater than zero");
	}

	return withOptimisticLockRetry(() =>
		withIdempotency(
			OperationKind.Deposit,
			params.idempotencyKey,
			// Hash só dos campos de negócio: requestId muda a cada tentativa física por
			// natureza (X-Request-Id é por requisição HTTP), não pode entrar no hash —
			// senão duas tentativas legítimas da mesma operação pareceriam payloads diferentes.
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

// fromUserId/toUserId: o body de POST /transfers manda { fromUserId, toUserId, amount },
// nunca accountId — mesma resolução via AccountsRepository.findByUserId dos dois lados.
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

	// Sempre atualiza as duas contas na mesma ordem (por id), nunca "from então to" —
	// senão duas transferências concorrentes em sentidos opostos entre as mesmas duas
	// contas travariam uma na outra (deadlock real do Postgres, não um conflito de versão).
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

	// As 2 entries sempre juntas, na mesma chamada — nunca um débito sem o crédito correspondente.
	await ledgerRepository.insertEntries([
		{ transactionId: transaction.id, accountId: fromAccount.id, type: "debit", amount: params.amount },
		{ transactionId: transaction.id, accountId: toAccount.id, type: "credit", amount: params.amount },
	]);

	// Devolve a conta de origem, pra manter o mesmo contrato de deposit/withdraw
	// (o front sempre olha a conta do usuário que iniciou a operação).
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
