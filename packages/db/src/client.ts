import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

import * as schema from "./schema";

export const client = new SQL(Bun.env.DATABASE_URL as string);

export const db = drizzle({ client, schema });
