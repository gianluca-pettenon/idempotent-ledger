import { Elysia } from "elysia";
import { getAccount } from "@api/features/projection/projection.service";

export const projectionRoutes = new Elysia()
	.get("/accounts/:userId", async ({ params }) => ({ data: await getAccount(params.userId) }));
