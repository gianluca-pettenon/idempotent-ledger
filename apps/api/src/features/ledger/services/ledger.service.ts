import { OperationKind } from "@banking-ledger/shared";
import {
	decideCreate,
	decideDeposit,
	decideTransfer,
	decideWithdraw,
	delta,
} from "@api/features/ledger/domain/ledger.domain";
import {
	type AccountAppend,
	appendEvents,
	findProcessedRequest,
	loadAccount,
} from "@api/features/ledger/repositories/ledger.repository";

enum Outcome {
	Processed = "processed",
	Duplicate = "duplicate",
}

const MAX_ATTEMPTS = 20;

// The whole request is stored with the idempotency record, so reusing a key for another payload is a 409.
type Operation = { accountId: string; [field: string]: unknown };

type Decision<T> = { appends: AccountAppend[]; response: T };

async function execute<T extends object>(request: Operation, key: string | null, decide: () => Promise<Decision<T>>) {
	const requestJson = JSON.stringify(request);

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (key) {
			const previous = await findProcessedRequest(request.accountId, key);

			if (previous) {
				if (previous.request !== requestJson) {
					throw new Error(`Idempotency-Key "${key}" was already used with a different request`, { cause: 409 });
				}

				return { ...(previous.response as T), outcome: Outcome.Duplicate };
			}
		}

		const { appends, response } = await decide();
		const processed = key ? { accountId: request.accountId, key, request: requestJson, response } : undefined;

		if (await appendEvents(appends, processed)) {
			return { ...response, outcome: Outcome.Processed };
		}
	}

	throw new Error("Account is under heavy contention, retry later", { cause: 409 });
}

export function createAccount(accountId: string, ownerName: string) {
	return execute({ accountId, ownerName }, null, async () => {
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
			response: { balance: account.balance + delta(event) },
		};
	});
}

export function withdraw(accountId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Withdraw, accountId, amount }, key, async () => {
		const account = await loadAccount(accountId);
		const event = decideWithdraw(account, amount);

		return {
			appends: [{ accountId, revision: account.revision, event }],
			response: { balance: account.balance + delta(event) },
		};
	});
}

export function transfer(fromAccountId: string, toAccountId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Transfer, accountId: fromAccountId, toAccountId, amount }, key, async () => {
		const [from, to] = await Promise.all([loadAccount(fromAccountId), loadAccount(toAccountId)]);
		const [sent, received] = decideTransfer(from, to, amount, Bun.randomUUIDv7());

		return {
			appends: [
				{ accountId: fromAccountId, revision: from.revision, event: sent },
				{ accountId: toAccountId, revision: to.revision, event: received },
			],
			response: { balance: from.balance + delta(sent) },
		};
	});
}
