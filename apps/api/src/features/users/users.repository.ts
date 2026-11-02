import { sql } from "@api/db/db";

export function findUsers() {
	return sql`SELECT id, name FROM users ORDER BY name`;
}

export async function userExists(id: string) {
	const [row] = await sql`SELECT 1 FROM users WHERE id = ${id}`;

	return Boolean(row);
}
