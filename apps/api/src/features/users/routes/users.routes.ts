import { Elysia } from "elysia";
import { findUsers } from "@api/features/users/repositories/users.repository";

export const usersRoutes = new Elysia().get("/users", async () => ({ data: await findUsers() }));
