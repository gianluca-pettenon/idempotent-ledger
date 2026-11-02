import { Elysia } from "elysia";
import { createAccount, deposit, transfer, withdraw } from "@api/features/ledger/services/ledger.service";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type NewAccount = { ownerName: string };
type Movement = { amount: number };
type Transfer = { fromAccountId: string; toAccountId: string; amount: number };

export const ledgerRoutes = new Elysia()
	.post("/accounts", async ({ body, request, set }) => {
		set.status = 201;

		return { data: await createAccount((body as NewAccount).ownerName, request.headers.get(IDEMPOTENCY_KEY_HEADER)) };
	})
	.post("/accounts/:accountId/deposits", async ({ params, body, request }) => ({
		data: await deposit(params.accountId, (body as Movement).amount, request.headers.get(IDEMPOTENCY_KEY_HEADER)),
	}))
	.post("/accounts/:accountId/withdrawals", async ({ params, body, request }) => ({
		data: await withdraw(params.accountId, (body as Movement).amount, request.headers.get(IDEMPOTENCY_KEY_HEADER)),
	}))
	.post("/transfers", async ({ body, request }) => {
		const { fromAccountId, toAccountId, amount } = body as Transfer;

		return { data: await transfer(fromAccountId, toAccountId, amount, request.headers.get(IDEMPOTENCY_KEY_HEADER)) };
	});
