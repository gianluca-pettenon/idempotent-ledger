import {
	AccountNotFoundError,
	InsufficientBalanceError,
	InvalidAmountError,
	OptimisticLockError,
	SameAccountTransferError,
} from "@banking-ledger/ledger";
import { IdempotencyKeyReusedError } from "@banking-ledger/idempotency";

const HttpStatus = {
	BadRequest: 400,
	NotFound: 404,
	Conflict: 409,
	UnprocessableEntity: 422,
} as const;

function respond(status: number, message: string) {
	return new Response(JSON.stringify({ success: false, message }), { status });
}

export function mapDomainErrors({ error }: { error: unknown }) {
	if (error instanceof AccountNotFoundError) {
		return respond(HttpStatus.NotFound, error.message);
	}

	if (error instanceof InsufficientBalanceError || error instanceof SameAccountTransferError) {
		return respond(HttpStatus.UnprocessableEntity, error.message);
	}

	if (error instanceof InvalidAmountError) {
		return respond(HttpStatus.BadRequest, error.message);
	}

	if (error instanceof IdempotencyKeyReusedError) {
		return respond(HttpStatus.Conflict, error.message);
	}

	// Não deveria acontecer em uso normal: o retry otimista (packages/ledger) já resolve
	// conflitos de versão internamente. Se ainda assim vazar, é contenção esgotando as
	// tentativas — 409 é mais honesto que deixar cair no 500 genérico.
	if (error instanceof OptimisticLockError) {
		return respond(HttpStatus.Conflict, error.message);
	}
}
