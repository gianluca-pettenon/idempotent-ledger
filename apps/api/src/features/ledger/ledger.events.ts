export enum EventType {
	AccountCreated = "AccountCreated",
	MoneyDeposited = "MoneyDeposited",
	MoneyWithdrawn = "MoneyWithdrawn",
	TransferSent = "TransferSent",
	TransferReceived = "TransferReceived",
}

type Movement = {
	accountId: string;
	amount: number;
	balance: number;
};

type Transfer = Movement & {
	transferId: string;
	counterpartyAccountId: string;
};

export type AccountEvent =
	| { type: EventType.AccountCreated; data: { accountId: string; ownerName: string; balance: number } }
	| { type: EventType.MoneyDeposited; data: Movement }
	| { type: EventType.MoneyWithdrawn; data: Movement }
	| { type: EventType.TransferSent; data: Transfer }
	| { type: EventType.TransferReceived; data: Transfer };

export type MovementEvent = Exclude<AccountEvent, { type: EventType.AccountCreated }>;
