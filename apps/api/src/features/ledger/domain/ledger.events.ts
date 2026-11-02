export enum EventType {
	AccountCreated = "AccountCreated",
	MoneyDeposited = "MoneyDeposited",
	MoneyWithdrawn = "MoneyWithdrawn",
	TransferSent = "TransferSent",
	TransferReceived = "TransferReceived",
	RequestProcessed = "RequestProcessed",
}

export enum StreamPrefix {
	Account = "Account-",
	Idempotency = "Idempotency-",
}

export type MovementType = EventType.MoneyDeposited | EventType.MoneyWithdrawn | EventType.TransferSent | EventType.TransferReceived;
