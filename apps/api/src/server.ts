import { openapi } from "@elysia/openapi";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { ledgerRoutes } from "@api/features/ledger/ledger.routes";
import { projectionRoutes } from "@api/features/projection/projection.routes";
import { usersRoutes } from "@api/features/users/users.routes";

export const app = new Elysia({ prefix: "/api" })
	.use(cors({ origin: Bun.env.WEB_ORIGIN, allowedHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"] }))
	.use(openapi({ path: "/docs" }))
	.onError(({ code, error, set }) => {
		if (code !== "UNKNOWN") return;

		set.status = typeof error.cause === "number" ? error.cause : 500;
		return { message: error.message };
	})
	.use(usersRoutes)
	.use(ledgerRoutes)
	.use(projectionRoutes);

if (import.meta.main) {
	app.listen(Number(Bun.env.API_PORT));
	console.log(`API ready at http://localhost:${Bun.env.API_PORT}`);
}
