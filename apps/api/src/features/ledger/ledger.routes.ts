import { Elysia, t } from "elysia";
import { deposit, transfer, withdraw } from "@api/features/ledger/ledger.service";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const key = (request: Request) => request.headers.get(IDEMPOTENCY_KEY_HEADER);
const movement = { body: t.Object({ amount: t.Number({ exclusiveMinimum: 0 }) }) };

export const ledgerRoutes = new Elysia()
	.post("/accounts/:accountId/deposits", async ({ params, body, request }) => ({ data: await deposit(params.accountId, body.amount, key(request)) }), movement)
	.post("/accounts/:accountId/withdrawals", async ({ params, body, request }) => ({ data: await withdraw(params.accountId, body.amount, key(request)) }), movement)
	.post(
		"/transfers",
		async ({ body, request }) => ({ data: await transfer(body.fromAccountId, body.toAccountId, body.amount, key(request)) }),
		{ body: t.Object({ fromAccountId: t.String(), toAccountId: t.String(), amount: t.Number({ exclusiveMinimum: 0 }) }) },
	);
