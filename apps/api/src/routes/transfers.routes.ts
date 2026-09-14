import { Elysia, t } from "elysia";
import { transfer } from "@api/features/ledger";
import { readRequestMeta } from "@api/request-meta";

const transferBodySchema = t.Object({
	fromUserId: t.String(),
	toUserId: t.String(),
	amount: t.Number(),
});

export const transfersRoutes = new Elysia().post(
	"/transfers",
	async ({ body, request }) => {
		const { idempotencyKey, requestId } = readRequestMeta(request);

		const { result: account, outcome } = await transfer({
			fromUserId: body.fromUserId,
			toUserId: body.toUserId,
			amount: body.amount,
			requestId,
			idempotencyKey,
		});

		return { success: true, account, meta: { outcome } };
	},
	{
		body: transferBodySchema,
		detail: {
			summary: "Create a transfer",
			tags: ["transfers"],
		},
	},
);
