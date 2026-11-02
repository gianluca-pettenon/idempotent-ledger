import { Elysia } from "elysia";
import { getAccount, listAccounts } from "@api/features/projection/services/projection.service";

export const projectionRoutes = new Elysia()
	.get("/accounts", async () => ({ data: await listAccounts() }))
	.get("/accounts/:accountId", async ({ params }) => ({ data: await getAccount(params.accountId) }));
