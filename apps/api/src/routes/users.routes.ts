import { listUsers } from "@banking-ledger/ledger";
import { Elysia } from "elysia";

export const usersRoutes = new Elysia().get(
	"/users",
	async () => ({ success: true, users: await listUsers() }),
	{
		detail: {
			summary: "List users",
			tags: ["users"],
		},
	},
);
