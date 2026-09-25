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
