export enum AccountEventType {
	AccountCreated = "AccountCreated",
	MoneyDeposited = "MoneyDeposited",
	MoneyWithdrawn = "MoneyWithdrawn",
	TransferSent = "TransferSent",
	TransferReceived = "TransferReceived",
}

export enum Outcome {
	Processed = "processed",
	Duplicate = "duplicate",
}

type Movement = { accountId: string; amount: number };
type TransferMovement = Movement & { transferId: string; counterpartyAccountId: string };

export type AccountEvent =
	| { type: AccountEventType.AccountCreated; data: { accountId: string; ownerName: string } }
	| { type: AccountEventType.MoneyDeposited; data: Movement }
	| { type: AccountEventType.MoneyWithdrawn; data: Movement }
	| { type: AccountEventType.TransferSent; data: TransferMovement }
	| { type: AccountEventType.TransferReceived; data: TransferMovement };

export type Account = { accountId: string; opened: boolean; balance: number };

const SIGN: Record<Exclude<AccountEventType, AccountEventType.AccountCreated>, 1 | -1> = {
	[AccountEventType.MoneyDeposited]: 1,
	[AccountEventType.TransferReceived]: 1,
	[AccountEventType.MoneyWithdrawn]: -1,
	[AccountEventType.TransferSent]: -1,
};

export function delta(event: AccountEvent) {
	return event.type === AccountEventType.AccountCreated ? 0 : SIGN[event.type] * event.data.amount;
}

export function balanceOf(events: AccountEvent[]) {
	return events.reduce((balance, event) => balance + delta(event), 0);
}

function assertAmount(amount: number) {
	if (!Number.isSafeInteger(amount) || amount <= 0) {
		throw new Error("Amount must be a positive integer", { cause: 422 });
	}
}

function assertOpened(account: Account) {
	if (!account.opened) {
		throw new Error(`Account ${account.accountId} not found`, { cause: 404 });
	}
}

function assertFunds(account: Account, amount: number) {
	if (account.balance < amount) {
		throw new Error(`Account ${account.accountId} has insufficient balance`, { cause: 422 });
	}
}

export function decideCreate(account: Account, ownerName: string): AccountEvent {
	if (typeof ownerName !== "string" || !ownerName.trim()) {
		throw new Error("Owner name is required", { cause: 422 });
	}

	if (account.opened) {
		throw new Error(`Account ${account.accountId} already exists`, { cause: 409 });
	}

	return { type: AccountEventType.AccountCreated, data: { accountId: account.accountId, ownerName: ownerName.trim() } };
}

export function decideDeposit(account: Account, amount: number): AccountEvent {
	assertOpened(account);
	assertAmount(amount);

	return { type: AccountEventType.MoneyDeposited, data: { accountId: account.accountId, amount } };
}

export function decideWithdraw(account: Account, amount: number): AccountEvent {
	assertOpened(account);
	assertAmount(amount);
	assertFunds(account, amount);

	return { type: AccountEventType.MoneyWithdrawn, data: { accountId: account.accountId, amount } };
}

export function decideTransfer(from: Account, to: Account, amount: number): [AccountEvent, AccountEvent] {
	assertOpened(from);
	assertOpened(to);
	assertAmount(amount);

	if (from.accountId === to.accountId) {
		throw new Error("Cannot transfer to the same account", { cause: 422 });
	}

	assertFunds(from, amount);

	const transferId = Bun.randomUUIDv7();

	return [
		{
			type: AccountEventType.TransferSent,
			data: { accountId: from.accountId, transferId, counterpartyAccountId: to.accountId, amount },
		},
		{
			type: AccountEventType.TransferReceived,
			data: { accountId: to.accountId, transferId, counterpartyAccountId: from.accountId, amount },
		},
	];
}
