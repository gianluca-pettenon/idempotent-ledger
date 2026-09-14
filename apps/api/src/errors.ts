import {
	AccountNotFoundError,
	InsufficientBalanceError,
	InvalidAmountError,
	OptimisticLockError,
	SameAccountTransferError,
} from "@api/features/ledger";
import { IdempotencyKeyReusedError } from "@api/features/idempotency";

const HttpStatus = {
	BadRequest: 400,
	NotFound: 404,
	Conflict: 409,
	UnprocessableEntity: 422,
} as const;

const ERROR_STATUS = new Map<new (...args: never[]) => Error, number>([
	[AccountNotFoundError, HttpStatus.NotFound],
	[InsufficientBalanceError, HttpStatus.UnprocessableEntity],
	[SameAccountTransferError, HttpStatus.UnprocessableEntity],
	[InvalidAmountError, HttpStatus.BadRequest],
	[IdempotencyKeyReusedError, HttpStatus.Conflict],
	[OptimisticLockError, HttpStatus.Conflict],
]);

function respond(status: number, message: string) {
	return new Response(JSON.stringify({ success: false, message }), { status });
}

export function mapDomainErrors({ error }: { error: unknown }) {
	if (!(error instanceof Error)) {
		return;
	}

	for (const [ErrorClass, status] of ERROR_STATUS) {
		if (error instanceof ErrorClass) {
			return respond(status, error.message);
		}
	}
}
