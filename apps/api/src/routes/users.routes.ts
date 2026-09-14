import { Elysia } from "elysia";
import { listUsers } from "@api/features/ledger";

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
