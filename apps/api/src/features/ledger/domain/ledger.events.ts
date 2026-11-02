// Every event type written to KurrentDB.
export enum EventType {
	AccountCreated = "AccountCreated",
	MoneyDeposited = "MoneyDeposited",
	MoneyWithdrawn = "MoneyWithdrawn",
	TransferSent = "TransferSent",
	TransferReceived = "TransferReceived",
	AccountSnapshot = "AccountSnapshot",
	RequestProcessed = "RequestProcessed",
}

// Every stream KurrentDB holds: {prefix}{accountId}, plus -{key} for idempotency.
export enum StreamPrefix {
	Account = "account-",
	// Must not start with Account, or the projector would read snapshots as movements.
	Snapshot = "snapshot-account-",
	Idempotency = "idempotency-",
}

export type MovementType = EventType.MoneyDeposited | EventType.MoneyWithdrawn | EventType.TransferSent | EventType.TransferReceived;
