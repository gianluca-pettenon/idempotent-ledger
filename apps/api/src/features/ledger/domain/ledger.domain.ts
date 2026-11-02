export enum AccountEventType {
	MoneyDeposited = "MoneyDeposited",
	MoneyWithdrawn = "MoneyWithdrawn",
	TransferSent = "TransferSent",
	TransferReceived = "TransferReceived",
}

export enum Outcome {
	Processed = "processed",
	Duplicate = "duplicate",
}

export type AccountEvent =
	| { type: AccountEventType.MoneyDeposited; data: { amount: number } }
	| { type: AccountEventType.MoneyWithdrawn; data: { amount: number } }
	| { type: AccountEventType.TransferSent; data: { transferId: string; toUserId: string; amount: number } }
	| { type: AccountEventType.TransferReceived; data: { transferId: string; fromUserId: string; amount: number } };

export type Account = { userId: string; balance: number };

const SIGN: Record<AccountEventType, 1 | -1> = {
	[AccountEventType.MoneyDeposited]: 1,
	[AccountEventType.TransferReceived]: 1,
	[AccountEventType.MoneyWithdrawn]: -1,
	[AccountEventType.TransferSent]: -1,
};

export function balanceOf(events: AccountEvent[]) {
	return events.reduce((balance, event) => balance + SIGN[event.type] * event.data.amount, 0);
}

function assertAmount(amount: number) {
	if (!Number.isSafeInteger(amount) || amount <= 0) {
		throw new Error("Amount must be a positive integer", { cause: 422 });
	}
}

function assertFunds(account: Account, amount: number) {
	if (account.balance < amount) {
		throw new Error(`Account ${account.userId} has insufficient balance`, { cause: 422 });
	}
}

export function decideDeposit(amount: number): AccountEvent {
	assertAmount(amount);

	return { type: AccountEventType.MoneyDeposited, data: { amount } };
}

export function decideWithdraw(account: Account, amount: number): AccountEvent {
	assertAmount(amount);
	assertFunds(account, amount);

	return { type: AccountEventType.MoneyWithdrawn, data: { amount } };
}

export function decideTransfer(from: Account, to: Account, amount: number): [AccountEvent, AccountEvent] {
	assertAmount(amount);

	if (from.userId === to.userId) {
		throw new Error("Cannot transfer to the same account", { cause: 422 });
	}

	assertFunds(from, amount);

	const transferId = Bun.randomUUIDv7();

	return [
		{ type: AccountEventType.TransferSent, data: { transferId, toUserId: to.userId, amount } },
		{ type: AccountEventType.TransferReceived, data: { transferId, fromUserId: from.userId, amount } },
	];
}
