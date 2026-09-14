import { openapi } from "@elysia/openapi";
import { Elysia } from "elysia";
import { mapDomainErrors } from "@api/errors";
import { accountsRoutes } from "@api/routes/accounts.routes";
import { healthRoutes } from "@api/routes/health.routes";
import { transfersRoutes } from "@api/routes/transfers.routes";
import { usersRoutes } from "@api/routes/users.routes";

const port = Number(Bun.env.API_PORT);

const app = new Elysia({ prefix: "/api" })
	.use(openapi({ path: "/docs" }))
	.onError(mapDomainErrors)
	.use(healthRoutes)
	.use(usersRoutes)
	.use(accountsRoutes)
	.use(transfersRoutes);

app.listen(port);

console.log(`API ready at http://localhost:${port}`);
