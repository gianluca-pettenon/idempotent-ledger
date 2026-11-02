import { Elysia } from "elysia";
import { reverseTransaction } from "@api/features/ledger";
import { toPublicJson } from "@api/features/ledger/public-json";
import { readRequestMeta } from "@api/request-meta";

export const reversalsRoutes = new Elysia().post(
	"/transactions/:transactionId/reversals",
	async ({ params, request }) => {
		const { idempotencyKey, requestId } = readRequestMeta(request);
		const { result, outcome } = await reverseTransaction({
			transactionId: params.transactionId,
			requestId,
			idempotencyKey,
		});

		return { success: true, reversal: toPublicJson(result), meta: { outcome } };
	},
	{
		detail: {
			summary: "Reverse a posted transaction",
			tags: ["transactions"],
		},
	},
);
