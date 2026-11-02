import { Elysia } from "elysia";
import { getAccount, listUsers } from "@api/features/projection/projection";

export const projectionRoutes = new Elysia()
	.get("/users", async () => ({ users: await listUsers() }))
	.get("/accounts/:userId", async ({ params }) => ({ account: await getAccount(params.userId) }));
