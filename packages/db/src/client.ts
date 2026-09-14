import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

import * as schema from "./schema";

export const client = new SQL(Bun.env.DATABASE_URL as string);

export const db = drizzle({ client, schema });

type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DbClient = typeof db | TransactionClient;
