import { Elysia } from "elysia";
import { deposit, transfer, withdraw } from "@api/features/ledger/ledger.service";

type Movement = { amount: number };
type Transfer = { fromUserId: string; toUserId: string; amount: number };

export const ledgerRoutes = new Elysia()
	.post("/accounts/:userId/deposits", async ({ params, body, request }) => ({
		data: await deposit(params.userId, (body as Movement).amount, request.headers.get("Idempotency-Key")),
	}))
	.post("/accounts/:userId/withdrawals", async ({ params, body, request }) => ({
		data: await withdraw(params.userId, (body as Movement).amount, request.headers.get("Idempotency-Key")),
	}))
	.post("/transfers", async ({ body, request }) => {
		const { fromUserId, toUserId, amount } = body as Transfer;

		return { data: await transfer(fromUserId, toUserId, amount, request.headers.get("Idempotency-Key")) };
	});
