import { StatusMap } from "elysia";

export class AccountNotFoundError extends Error {
	status = StatusMap["Not Found"];
}

export class InsufficientBalanceError extends Error {
	status = StatusMap["Unprocessable Content"];
}

export class SameAccountTransferError extends Error {
	status = StatusMap["Unprocessable Content"];
}

export class InvalidAmountError extends Error {
	status = StatusMap["Bad Request"];
}

export class OptimisticLockError extends Error {
	status = StatusMap.Conflict;
}

export class CurrencyMismatchError extends Error {
	status = StatusMap["Unprocessable Content"];
}

export class SettlementAccountNotFoundError extends Error {
	status = StatusMap["Internal Server Error"];
}

export class TransactionNotFoundError extends Error {
	status = StatusMap["Not Found"];
}

export class AlreadyReversedError extends Error {
	status = StatusMap.Conflict;
}

export class CannotReverseReversalError extends Error {
	status = StatusMap["Unprocessable Content"];
}

export class InvalidTransitionError extends Error {
	status = StatusMap["Unprocessable Content"];
}
