import { Elysia } from "elysia";
import { deposit, transfer, withdraw } from "@api/features/ledger/ledger";

type Movement = { amount: number };
type Transfer = { fromUserId: string; toUserId: string; amount: number };

export const ledgerRoutes = new Elysia()
	.post("/accounts/:userId/deposits", ({ params, body, headers }) =>
		deposit(params.userId, (body as Movement).amount, headers["idempotency-key"] ?? null),
	)
	.post("/accounts/:userId/withdrawals", ({ params, body, headers }) =>
		withdraw(params.userId, (body as Movement).amount, headers["idempotency-key"] ?? null),
	)
	.post("/transfers", ({ body, headers }) => {
		const { fromUserId, toUserId, amount } = body as Transfer;

		return transfer(fromUserId, toUserId, amount, headers["idempotency-key"] ?? null);
	});
