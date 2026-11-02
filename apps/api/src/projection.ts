import { SQL, type TransactionSQL } from "bun";
import { type RecordedEvent, START, streamNameFilter } from "@kurrent/kurrentdb-client";
import { LedgerError, store } from "@api/ledger";

export const sql = new SQL(Bun.env.DATABASE_URL as string);

const RECENT_TRANSACTIONS = 20;

const MOVEMENTS: Record<string, { type: string; sign: 1 | -1; counterparty?: "toUserId" | "fromUserId" }> = {
	MoneyDeposited: { type: "deposit", sign: 1 },
	MoneyWithdrawn: { type: "withdraw", sign: -1 },
	TransferSent: { type: "transfer_out", sign: -1, counterparty: "toUserId" },
	TransferReceived: { type: "transfer_in", sign: 1, counterparty: "fromUserId" },
};

// shortcut: idempotent CREATE IF NOT EXISTS instead of versioned migrations, adopt a migration tool once the schema evolves.
export async function migrate() {
	await sql.unsafe(await Bun.file(new URL("./schema.sql", import.meta.url)).text());
}

async function project(tx: TransactionSQL, event: RecordedEvent) {
	const data = event.data as Record<string, string | number>;

	if (event.type === "UserRegistered") {
		await tx`INSERT INTO users (id, name) VALUES (${data.id}, ${data.name})`;
		return;
	}

	const userId = event.streamId.slice("account-".length);

	if (event.type === "AccountOpened") {
		await tx`INSERT INTO accounts (user_id) VALUES (${userId})`;
		return;
	}

	const movement = MOVEMENTS[event.type];
	if (!movement) return;

	const amount = Number(data.amount);

	await tx`UPDATE accounts SET balance = balance + ${movement.sign * amount} WHERE user_id = ${userId}`;
	await tx`
		INSERT INTO transactions (id, user_id, type, amount, counterparty_user_id, created_at, position)
		VALUES (${event.id}, ${userId}, ${movement.type}, ${amount}, ${movement.counterparty ? data[movement.counterparty] : null}, ${event.created}, ${String(event.position?.commit)})
	`;
}

// Catch-up subscription on $all. The checkpoint is saved in the same SQL transaction as the
// projection, so a crash never applies an event twice nor skips one.
export async function runProjector() {
	await migrate();

	const [checkpoint] = await sql`SELECT commit, prepare FROM checkpoint`;
	const subscription = store.subscribeToAll({
		fromPosition: checkpoint ? { commit: BigInt(checkpoint.commit), prepare: BigInt(checkpoint.prepare) } : START,
		filter: streamNameFilter({ prefixes: ["users", "account-"] }),
	});

	for await (const { event } of subscription) {
		if (!event?.position) continue;
		const { commit, prepare } = event.position;

		await sql.begin(async (tx) => {
			await project(tx, event);
			await tx`
				INSERT INTO checkpoint (commit, prepare) VALUES (${String(commit)}, ${String(prepare)})
				ON CONFLICT (id) DO UPDATE SET commit = excluded.commit, prepare = excluded.prepare
			`;
		});
	}
}

export function listUsers() {
	return sql`SELECT id, name FROM users ORDER BY name`;
}

export async function getAccount(userId: string) {
	const [account] = await sql`SELECT balance FROM accounts WHERE user_id = ${userId}`;

	if (!account) throw new LedgerError(404, `Account not found for user ${userId}`);

	const transactions = await sql`
		SELECT t.id, t.type, t.amount, t.created_at, t.counterparty_user_id, u.name AS counterparty_name
		FROM transactions t
		LEFT JOIN users u ON u.id = t.counterparty_user_id
		WHERE t.user_id = ${userId}
		ORDER BY t.position DESC
		LIMIT ${RECENT_TRANSACTIONS}
	`;

	return {
		balance: Number(account.balance),
		transactions: transactions.map((row: Record<string, string | Date | null>) => ({
			id: row.id,
			type: row.type,
			amount: Number(row.amount),
			createdAt: row.created_at,
			counterpartyUserId: row.counterparty_user_id ?? undefined,
			counterpartyName: row.counterparty_name ?? undefined,
		})),
	};
}

if (import.meta.main) await runProjector();
