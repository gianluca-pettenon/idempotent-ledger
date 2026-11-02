import { Elysia } from "elysia";
import { deposit, transfer, withdraw } from "@api/features/ledger/ledger";

type Movement = { amount: number };
type Transfer = { fromUserId: string; toUserId: string; amount: number };

export const ledgerRoutes = new Elysia()
	.post("/accounts/:userId/deposits", ({ params, body, request }) =>
		deposit(params.userId, (body as Movement).amount, request.headers.get("Idempotency-Key")),
	)
	.post("/accounts/:userId/withdrawals", ({ params, body, request }) =>
		withdraw(params.userId, (body as Movement).amount, request.headers.get("Idempotency-Key")),
	)
	.post("/transfers", ({ body, request }) => {
		const { fromUserId, toUserId, amount } = body as Transfer;

		return transfer(fromUserId, toUserId, amount, request.headers.get("Idempotency-Key"));
	});
