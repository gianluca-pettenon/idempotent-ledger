import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate as runMigrations } from "drizzle-orm/bun-sql/migrator";

export const sql = new SQL(Bun.env.DATABASE_URL as string);

export function migrate() {
	return runMigrations(drizzle({ client: sql }), { migrationsFolder: new URL("./migrations", import.meta.url).pathname });
}

if (import.meta.main) {
	await migrate();
	await sql.close();
}
