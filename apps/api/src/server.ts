import { openapi } from "@elysia/openapi";
import { cors } from "@elysiajs/cors";
import { TransactionKind } from "@banking-ledger/shared";
import { Elysia, t } from "elysia";
import { deposit, getAccount, LedgerError, listUsers, seedDefaultUsers, transfer, withdraw } from "@api/ledger";

const amount = t.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });

const idempotencyKey = (headers: Record<string, string | undefined>) => headers["idempotency-key"]?.trim() || null;

const reply = ({ balance, outcome }: { balance: number; outcome: string }) => ({ balance, meta: { outcome } });

export const app = new Elysia({ prefix: "/api" })
	.use(
		cors({
			origin: Bun.env.WEB_ORIGIN,
			methods: ["GET", "POST"],
			allowedHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"],
		}),
	)
	.use(openapi({ path: "/docs" }))
	.error({ LedgerError })
	.onError(({ code, error, set }) => {
		if (code !== "LedgerError") return;

		set.status = error.status;
		return { message: error.message };
	})
	.get("/health", () => ({ ok: true }))
	.get("/users", async () => ({ users: await listUsers() }))
	.get("/accounts/:userId", async ({ params }) => ({ account: await getAccount(params.userId) }))
	.post(
		"/accounts/:userId/transactions",
		async ({ body, params, headers }) => {
			const move = body.type === TransactionKind.Deposit ? deposit : withdraw;

			return reply(await move(params.userId, body.amount, idempotencyKey(headers)));
		},
		{
			body: t.Object({
				type: t.Union([t.Literal(TransactionKind.Deposit), t.Literal(TransactionKind.Withdraw)]),
				amount,
			}),
		},
	)
	.post(
		"/transfers",
		async ({ body, headers }) =>
			reply(await transfer(body.fromUserId, body.toUserId, body.amount, idempotencyKey(headers))),
		{ body: t.Object({ fromUserId: t.String(), toUserId: t.String(), amount }) },
	);

if (import.meta.main) {
	await seedDefaultUsers();
	app.listen(Number(Bun.env.API_PORT));
	console.log(`API ready at http://localhost:${Bun.env.API_PORT}`);
}
