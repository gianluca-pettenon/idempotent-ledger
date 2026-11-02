import { OperationKind } from "@banking-ledger/shared";
import {
	balanceOf,
	decideCreate,
	decideDeposit,
	decideTransfer,
	decideWithdraw,
	Outcome,
} from "@api/features/ledger/domain/ledger.domain";
import {
	type AccountAppend,
	AppendResult,
	appendEvents,
	findProcessedRequest,
	loadAccount,
} from "@api/features/ledger/repositories/ledger.repository";

const MAX_ATTEMPTS = 20;

// Fixed namespace so the same Idempotency-Key always derives the same account id.
const ACCOUNT_ID_NAMESPACE = "8f0c2e4a-3b1d-4c6e-9a7f-5d2b8e1c4a90";

// The whole request is stored with the idempotency record, so reusing a key for another payload is a 409.
type Request = { accountId: string; [field: string]: unknown };

type Decision<T> = { appends: AccountAppend[]; response: T };

async function execute<T extends object>(request: Request, key: string | null, decide: () => Promise<Decision<T>>) {
	const requestJson = JSON.stringify(request);
	let keyConflict = false;

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (key) {
			const previous = await findProcessedRequest(request.accountId, key);

			if (previous) {
				if (previous.request !== requestJson) {
					throw new Error(`Idempotency-Key "${key}" was already used with a different request`, { cause: 409 });
				}

				return { ...(previous.response as T), outcome: Outcome.Duplicate };
			}

			// The key's stream exists but its record is gone: it outlived its TTL.
			if (keyConflict) {
				throw new Error(`Idempotency-Key "${key}" has expired, use a new one`, { cause: 409 });
			}
		}

		const { appends, response } = await decide();
		const processed = key ? { accountId: request.accountId, key, request: requestJson, response } : undefined;
		const result = await appendEvents(appends, processed);

		if (result === AppendResult.Appended) {
			return { ...response, outcome: Outcome.Processed };
		}

		keyConflict = result === AppendResult.KeyConflict;
	}

	throw new Error("Account is under heavy contention, retry later", { cause: 409 });
}

export function createAccount(
	ownerName: string,
	key: string | null,
	accountId = key ? Bun.randomUUIDv5(key, ACCOUNT_ID_NAMESPACE) : Bun.randomUUIDv7(),
) {
	return execute({ accountId, ownerName }, key, async () => {
		const account = await loadAccount(accountId);
		const event = decideCreate(account, ownerName);

		return { appends: [{ accountId, revision: account.revision, event }], response: { accountId, balance: 0 } };
	});
}

export function deposit(accountId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Deposit, accountId, amount }, key, async () => {
		const account = await loadAccount(accountId);
		const event = decideDeposit(account, amount);

		return {
			appends: [{ accountId, revision: account.revision, event }],
			response: { balance: account.balance + balanceOf([event]) },
		};
	});
}

export function withdraw(accountId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Withdraw, accountId, amount }, key, async () => {
		const account = await loadAccount(accountId);
		const event = decideWithdraw(account, amount);

		return {
			appends: [{ accountId, revision: account.revision, event }],
			response: { balance: account.balance + balanceOf([event]) },
		};
	});
}

export function transfer(fromAccountId: string, toAccountId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Transfer, accountId: fromAccountId, toAccountId, amount }, key, async () => {
		const [from, to] = await Promise.all([loadAccount(fromAccountId), loadAccount(toAccountId)]);
		const [sent, received] = decideTransfer(from, to, amount);

		return {
			appends: [
				{ accountId: fromAccountId, revision: from.revision, event: sent },
				{ accountId: toAccountId, revision: to.revision, event: received },
			],
			response: { balance: from.balance + balanceOf([sent]) },
		};
	});
}
