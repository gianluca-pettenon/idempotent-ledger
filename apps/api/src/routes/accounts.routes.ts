import { deposit, getAccountSnapshot, withdraw } from "@banking-ledger/ledger";
import { TransactionKind } from "@banking-ledger/shared";
import { Elysia, t } from "elysia";
import { readRequestMeta } from "../request-meta";

const transactionBodySchema = t.Object({
	type: t.Union([t.Literal(TransactionKind.Deposit), t.Literal(TransactionKind.Withdraw)]),
	amount: t.Number(),
});

export const accountsRoutes = new Elysia()
	.get(
		"/accounts/:userId",
		async ({ params }) => ({
			success: true,
			account: await getAccountSnapshot(params.userId),
		}),
		{
			detail: {
				summary: "Get account snapshot",
				tags: ["accounts"],
			},
		},
	)
	.post(
		"/accounts/:userId/transactions",
		async ({ body, params, request }) => {
			const { idempotencyKey, requestId } = readRequestMeta(request);
			const applyMovement = body.type === TransactionKind.Deposit ? deposit : withdraw;

			const { result: account, outcome } = await applyMovement({
				userId: params.userId,
				amount: body.amount,
				requestId,
				idempotencyKey,
			});

			return { success: true, account, meta: { outcome } };
		},
		{
			body: transactionBodySchema,
			detail: {
				summary: "Create an account transaction",
				tags: ["accounts"],
			},
		},
	);
