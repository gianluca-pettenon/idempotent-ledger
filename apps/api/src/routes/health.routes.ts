import { Elysia } from "elysia";

export const healthRoutes = new Elysia().get(
	"/health",
	() => ({ success: true }),
	{
		detail: {
			summary: "Check API availability",
			tags: ["health"],
		},
	},
);
