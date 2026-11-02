import { openapi } from "@elysia/openapi";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { seedDefaultUsers } from "@api/features/ledger/ledger";
import { ledgerRoutes } from "@api/features/ledger/ledger.routes";
import { migrate } from "@api/features/projection/projection";
import { projectionRoutes } from "@api/features/projection/projection.routes";

export const app = new Elysia({ prefix: "/api" })
	.use(cors({ origin: Bun.env.WEB_ORIGIN, allowedHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"] }))
	.use(openapi({ path: "/docs" }))
	.use(ledgerRoutes)
	.use(projectionRoutes);

if (import.meta.main) {
	await Promise.all([migrate(), seedDefaultUsers()]);
	app.listen(Number(Bun.env.API_PORT));
	console.log(`API ready at http://localhost:${Bun.env.API_PORT}`);
}
