import { EventType, type MovementType } from "@api/features/ledger/domain/ledger.events";

type Movement = { accountId: string; amount: number };
type TransferMovement = Movement & { transferId: string; counterpartyAccountId: string };

export type AccountEvent =
	| { type: EventType.AccountCreated; data: { accountId: string; ownerName: string } }
	| { type: EventType.MoneyDeposited; data: Movement }
	| { type: EventType.MoneyWithdrawn; data: Movement }
	| { type: EventType.TransferSent; data: TransferMovement }
	| { type: EventType.TransferReceived; data: TransferMovement };

export type Account = { accountId: string; opened: boolean; balance: number };

const SIGN: Record<MovementType, 1 | -1> = {
	[EventType.MoneyDeposited]: 1,
	[EventType.TransferReceived]: 1,
	[EventType.MoneyWithdrawn]: -1,
	[EventType.TransferSent]: -1,
};

export function delta(event: AccountEvent) {
	return event.type === EventType.AccountCreated ? 0 : SIGN[event.type] * event.data.amount;
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
	if (account.opened) {
		throw new Error(`Account ${account.accountId} already exists`, { cause: 409 });
	}

	return { type: EventType.AccountCreated, data: { accountId: account.accountId, ownerName } };
}

export function decideDeposit(account: Account, amount: number): AccountEvent {
	assertOpened(account);
	assertAmount(amount);

	return { type: EventType.MoneyDeposited, data: { accountId: account.accountId, amount } };
}

export function decideWithdraw(account: Account, amount: number): AccountEvent {
	assertOpened(account);
	assertAmount(amount);
	assertFunds(account, amount);

	return { type: EventType.MoneyWithdrawn, data: { accountId: account.accountId, amount } };
}

export function decideTransfer(from: Account, to: Account, amount: number, transferId: string): [AccountEvent, AccountEvent] {
	assertOpened(from);
	assertOpened(to);
	assertAmount(amount);

	if (from.accountId === to.accountId) {
		throw new Error("Cannot transfer to the same account", { cause: 422 });
	}

	assertFunds(from, amount);

	return [
		{
			type: EventType.TransferSent,
			data: { accountId: from.accountId, transferId, counterpartyAccountId: to.accountId, amount },
		},
		{
			type: EventType.TransferReceived,
			data: { accountId: to.accountId, transferId, counterpartyAccountId: from.accountId, amount },
		},
	];
}
