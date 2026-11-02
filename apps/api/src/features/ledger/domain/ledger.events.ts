export enum EventType {
	AccountCreated = "AccountCreated",
	MoneyDeposited = "MoneyDeposited",
	MoneyWithdrawn = "MoneyWithdrawn",
	TransferSent = "TransferSent",
	TransferReceived = "TransferReceived",
	AccountSnapshot = "AccountSnapshot",
	RequestProcessed = "RequestProcessed",
}

export enum StreamPrefix {
	Account = "Account-",
	Snapshot = "Snapshot-Account-",
	Idempotency = "Idempotency-",
}

export type MovementType = EventType.MoneyDeposited | EventType.MoneyWithdrawn | EventType.TransferSent | EventType.TransferReceived;
