import { openapi } from "@elysia/openapi";
import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { mapDomainErrors } from "@api/errors";
import { accountsRoutes } from "@api/routes/accounts.routes";
import { healthRoutes } from "@api/routes/health.routes";
import { transfersRoutes } from "@api/routes/transfers.routes";
import { usersRoutes } from "@api/routes/users.routes";

const port = Number(Bun.env.API_PORT);

const app = new Elysia({ prefix: "/api" })
	.use(
		cors({
			origin: Bun.env.WEB_ORIGIN,
			methods: ["GET", "POST"],
			allowedHeaders: ["Content-Type", "Idempotency-Key", "X-Request-Id"],
		}),
	)
	.use(openapi({ path: "/docs" }))
	.onError(mapDomainErrors)
	.use(healthRoutes)
	.use(usersRoutes)
	.use(accountsRoutes)
	.use(transfersRoutes);

app.listen(port);

console.log(`API ready at http://localhost:${port}`);
