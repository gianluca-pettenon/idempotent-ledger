import type { TransactionSQL } from "bun";
import { sql } from "@api/db/db";

export type Movement = {
	id: string;
	userId: string;
	type: string;
	amount: number;
	counterpartyUserId: string | null;
	createdAt: Date;
	position: bigint;
};

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

export async function insertMovement(tx: TransactionSQL, movement: Movement, delta: number) {
	await tx`
		INSERT INTO accounts (user_id, balance) VALUES (${movement.userId}, ${delta})
		ON CONFLICT (user_id) DO UPDATE SET balance = accounts.balance + excluded.balance
	`;
	await tx`
		INSERT INTO transactions (id, user_id, type, amount, counterparty_user_id, created_at, position)
		VALUES (${movement.id}, ${movement.userId}, ${movement.type}, ${movement.amount},
			${movement.counterpartyUserId}, ${movement.createdAt}, ${String(movement.position)})
	`;
}

// Undefined when the user does not exist; 0 when it exists but has no movements yet.
export async function findBalance(userId: string) {
	const [row] = await sql`
		SELECT COALESCE(a.balance, 0) AS balance FROM users u LEFT JOIN accounts a ON a.user_id = u.id WHERE u.id = ${userId}
	`;

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
