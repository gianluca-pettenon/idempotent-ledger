// Pure business rules: no I/O. Each decide* turns a command into the events it produces, or throws.

export type AccountEvent =
	| { type: "AccountOpened"; data: Record<string, never> }
	| { type: "MoneyDeposited"; data: { amount: number } }
	| { type: "MoneyWithdrawn"; data: { amount: number } }
	| { type: "TransferSent"; data: { transferId: string; toUserId: string; amount: number } }
	| { type: "TransferReceived"; data: { transferId: string; fromUserId: string; amount: number } };

export type Account = { userId: string; balance: number };

export class LedgerError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}

	toResponse() {
		return Response.json({ message: this.message }, { status: this.status });
	}
}

export function balanceOf(events: AccountEvent[]) {
	return events.reduce((balance, event) => {
		switch (event.type) {
			case "MoneyDeposited":
			case "TransferReceived":
				return balance + event.data.amount;
			case "MoneyWithdrawn":
			case "TransferSent":
				return balance - event.data.amount;
			default:
				return balance;
		}
	}, 0);
}

function assertAmount(amount: number) {
	if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError(422, "Amount must be a positive integer");
}

function assertFunds(account: Account, amount: number) {
	if (account.balance < amount) throw new LedgerError(422, `Account ${account.userId} has insufficient balance`);
}

export function decideDeposit(amount: number): AccountEvent {
	assertAmount(amount);

	return { type: "MoneyDeposited", data: { amount } };
}

export function decideWithdraw(account: Account, amount: number): AccountEvent {
	assertAmount(amount);
	assertFunds(account, amount);

	return { type: "MoneyWithdrawn", data: { amount } };
}

export function decideTransfer(from: Account, to: Account, amount: number): [AccountEvent, AccountEvent] {
	assertAmount(amount);
	if (from.userId === to.userId) throw new LedgerError(422, "Cannot transfer to the same account");
	assertFunds(from, amount);

	const transferId = Bun.randomUUIDv7();

	return [
		{ type: "TransferSent", data: { transferId, toUserId: to.userId, amount } },
		{ type: "TransferReceived", data: { transferId, fromUserId: from.userId, amount } },
	];
}
