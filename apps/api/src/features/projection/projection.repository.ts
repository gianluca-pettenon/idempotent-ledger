import { SQL, type TransactionSQL } from "bun";

const sql = new SQL(Bun.env.DATABASE_URL as string);

export type Movement = {
	id: string;
	userId: string;
	type: string;
	amount: number;
	counterpartyUserId: string | null;
	createdAt: Date;
	position: bigint;
};

// shortcut: idempotent CREATE IF NOT EXISTS instead of versioned migrations, adopt a migration tool once the schema evolves.
export async function migrate() {
	await sql.unsafe(await Bun.file(new URL("./schema.sql", import.meta.url)).text());
}

export function transaction(work: (tx: TransactionSQL) => Promise<void>) {
	return sql.begin(work);
}

export async function findCheckpoint() {
	const [row] = await sql`SELECT commit, prepare FROM checkpoint`;

	return row && { commit: BigInt(row.commit), prepare: BigInt(row.prepare) };
}

export async function saveCheckpoint(tx: TransactionSQL, position: { commit: bigint; prepare: bigint }) {
	await tx`
		INSERT INTO checkpoint (commit, prepare) VALUES (${String(position.commit)}, ${String(position.prepare)})
		ON CONFLICT (id) DO UPDATE SET commit = excluded.commit, prepare = excluded.prepare
	`;
}

export async function insertUser(tx: TransactionSQL, user: { id: string; name: string }) {
	await tx`INSERT INTO users (id, name) VALUES (${user.id}, ${user.name})`;
}

export async function insertAccount(tx: TransactionSQL, userId: string) {
	await tx`INSERT INTO accounts (user_id) VALUES (${userId})`;
}

export async function insertMovement(tx: TransactionSQL, movement: Movement, delta: number) {
	await tx`UPDATE accounts SET balance = balance + ${delta} WHERE user_id = ${movement.userId}`;
	await tx`
		INSERT INTO transactions (id, user_id, type, amount, counterparty_user_id, created_at, position)
		VALUES (${movement.id}, ${movement.userId}, ${movement.type}, ${movement.amount},
			${movement.counterpartyUserId}, ${movement.createdAt}, ${String(movement.position)})
	`;
}

export function findUsers() {
	return sql`SELECT id, name FROM users ORDER BY name`;
}

export async function findBalance(userId: string) {
	const [row] = await sql`SELECT balance FROM accounts WHERE user_id = ${userId}`;

	return row && Number(row.balance);
}

export async function findRecentTransactions(userId: string, limit: number) {
	const rows = await sql`
		SELECT t.id, t.type, t.amount, t.created_at, t.counterparty_user_id, u.name AS counterparty_name
		FROM transactions t
		LEFT JOIN users u ON u.id = t.counterparty_user_id
		WHERE t.user_id = ${userId}
		ORDER BY t.position DESC
		LIMIT ${limit}
	`;

	return rows.map((row: Record<string, string | Date | null>) => ({
		id: row.id,
		type: row.type,
		amount: Number(row.amount),
		createdAt: row.created_at,
		counterpartyUserId: row.counterparty_user_id ?? undefined,
		counterpartyName: row.counterparty_name ?? undefined,
	}));
}
