import { OperationKind } from "@banking-ledger/shared";
import { balanceOf, decideDeposit, decideTransfer, decideWithdraw, Outcome } from "@api/features/ledger/domain/ledger.domain";
import { type AccountAppend, appendEvents, findProcessedRequest, loadAccount } from "@api/features/ledger/repositories/ledger.repository";
import { userExists } from "@api/features/users/repositories/users.repository";

const MAX_ATTEMPTS = 20;

type Request = { type: OperationKind; userId: string; toUserId?: string; amount: number };

type Decision = { appends: AccountAppend[]; balance: number };

async function execute(request: Request, key: string | null, decide: () => Promise<Decision>) {
	for (const userId of [request.userId, request.toUserId].filter((id) => id !== undefined)) {
		if (!(await userExists(userId))) {
			throw new Error(`Account not found for user ${userId}`, { cause: 404 });
		}
	}

	const requestJson = JSON.stringify(request);

	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		if (key) {
			const previous = await findProcessedRequest(request.userId, key);

			if (previous) {
				if (previous.request !== requestJson) {
					throw new Error(`Idempotency-Key "${key}" was already used with a different request`, { cause: 409 });
				}

				return { balance: previous.balance, outcome: Outcome.Duplicate };
			}
		}

		const { appends, balance } = await decide();
		const processed = key ? { userId: request.userId, key, request: requestJson, balance } : undefined;

		if (await appendEvents(appends, processed)) {
			return { balance, outcome: Outcome.Processed };
		}
	}

	throw new Error("Account is under heavy contention, retry later", { cause: 409 });
}

export function deposit(userId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Deposit, userId, amount }, key, async () => {
		const account = await loadAccount(userId);
		const event = decideDeposit(amount);

		return { appends: [{ userId, revision: account.revision, event }], balance: account.balance + balanceOf([event]) };
	});
}

export function withdraw(userId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Withdraw, userId, amount }, key, async () => {
		const account = await loadAccount(userId);
		const event = decideWithdraw(account, amount);

		return { appends: [{ userId, revision: account.revision, event }], balance: account.balance + balanceOf([event]) };
	});
}

export function transfer(fromUserId: string, toUserId: string, amount: number, key: string | null) {
	return execute({ type: OperationKind.Transfer, userId: fromUserId, toUserId, amount }, key, async () => {
		const [from, to] = await Promise.all([loadAccount(fromUserId), loadAccount(toUserId)]);
		const [sent, received] = decideTransfer(from, to, amount);

		return {
			appends: [
				{ userId: fromUserId, revision: from.revision, event: sent },
				{ userId: toUserId, revision: to.revision, event: received },
			],
			balance: from.balance + balanceOf([sent]),
		};
	});
}
