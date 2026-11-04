import { type Account, type Append, append, findResponse, loadAccount } from "@api/features/ledger/ledger.store";
import { EventType } from "@api/features/ledger/ledger.events";

enum Outcome {
	Processed = "processed",
	Duplicate = "duplicate",
}

const MAX_ATTEMPTS = 10;

type Decision = { appends: Append[]; balance: number };

// Optimistic concurrency: on a conflict, read again and decide again.
async function execute(key: string | null, decide: () => Promise<Decision>) {
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const previous = key && (await findResponse(key));

		if (previous) {
			return { ...previous, outcome: Outcome.Duplicate };
		}

		const { appends, balance } = await decide();

		if (await append(appends, key, { balance })) {
			return { balance, outcome: Outcome.Processed };
		}
	}

	throw new Error("Account is under heavy contention, retry later", { cause: 409 });
}

function assertFunds(account: Account, amount: number) {
	if (account.balance < amount) {
		throw new Error("Insufficient balance", { cause: 422 });
	}
}

// Every movement carries the balance it leaves behind, so the read model never depends on event order.
export const deposit = (accountId: string, amount: number, key: string | null) =>
	execute(key, async () => {
		const account = await loadAccount(accountId);
		const balance = account.balance + amount;

		return { appends: [{ account, event: { type: EventType.MoneyDeposited, data: { accountId, amount, balance } } }], balance };
	});

export const withdraw = (accountId: string, amount: number, key: string | null) =>
	execute(key, async () => {
		const account = await loadAccount(accountId);
		assertFunds(account, amount);
		const balance = account.balance - amount;

		return { appends: [{ account, event: { type: EventType.MoneyWithdrawn, data: { accountId, amount, balance } } }], balance };
	});

export const transfer = (fromAccountId: string, toAccountId: string, amount: number, key: string | null) =>
	execute(key, async () => {
		const [from, to] = await Promise.all([loadAccount(fromAccountId), loadAccount(toAccountId)]);
		assertFunds(from, amount);

		const transferId = Bun.randomUUIDv7();
		const sent = { accountId: fromAccountId, counterpartyAccountId: toAccountId, transferId, amount, balance: from.balance - amount };
		const received = { accountId: toAccountId, counterpartyAccountId: fromAccountId, transferId, amount, balance: to.balance + amount };

		return {
			appends: [
				{ account: from, event: { type: EventType.TransferSent, data: sent } },
				{ account: to, event: { type: EventType.TransferReceived, data: received } },
			],
			balance: sent.balance,
		};
	});
