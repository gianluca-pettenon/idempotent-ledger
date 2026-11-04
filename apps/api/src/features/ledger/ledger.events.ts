export enum EventType {
	AccountCreated = "AccountCreated",
	MoneyDeposited = "MoneyDeposited",
	MoneyWithdrawn = "MoneyWithdrawn",
	TransferSent = "TransferSent",
	TransferReceived = "TransferReceived",
}

type Movement = { accountId: string; amount: number; balance: number };
type Transfer = Movement & { transferId: string; counterpartyAccountId: string };

export type AccountEvent =
	| { type: EventType.AccountCreated; data: { accountId: string; ownerName: string } }
	| { type: EventType.MoneyDeposited; data: Movement }
	| { type: EventType.MoneyWithdrawn; data: Movement }
	| { type: EventType.TransferSent; data: Transfer }
	| { type: EventType.TransferReceived; data: Transfer };

export type MovementEvent = Exclude<AccountEvent, { type: EventType.AccountCreated }>;

const SIGN: Record<MovementEvent["type"], 1 | -1> = {
	[EventType.MoneyDeposited]: 1,
	[EventType.TransferReceived]: 1,
	[EventType.MoneyWithdrawn]: -1,
	[EventType.TransferSent]: -1,
};

export const delta = (event: AccountEvent) => (event.type === EventType.AccountCreated ? 0 : SIGN[event.type] * event.data.amount);
