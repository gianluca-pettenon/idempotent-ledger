import { Elysia } from "elysia";
import { findUsers } from "@api/features/users/users.repository";

export const usersRoutes = new Elysia().get("/users", async () => ({ data: await findUsers() }));
