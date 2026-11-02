import type { TransactionSQL } from "bun";
import { type RecordedEvent, START, streamNameFilter } from "@kurrent/kurrentdb-client";
import { LedgerError } from "@api/features/ledger/ledger.domain";
import { store } from "@api/features/ledger/ledger.repository";
import {
	findBalance,
	findCheckpoint,
	findRecentTransactions,
	findUsers,
	insertAccount,
	insertMovement,
	insertUser,
	migrate,
	saveCheckpoint,
	transaction,
} from "@api/features/projection/projection.repository";

const RECENT_TRANSACTIONS = 20;

const MOVEMENTS: Record<string, { type: string; sign: 1 | -1; counterparty?: "toUserId" | "fromUserId" }> = {
	MoneyDeposited: { type: "deposit", sign: 1 },
	MoneyWithdrawn: { type: "withdraw", sign: -1 },
	TransferSent: { type: "transfer_out", sign: -1, counterparty: "toUserId" },
	TransferReceived: { type: "transfer_in", sign: 1, counterparty: "fromUserId" },
};

async function project(tx: TransactionSQL, event: RecordedEvent) {
	const data = event.data as Record<string, string | number>;

	if (event.type === "UserRegistered") return insertUser(tx, data as { id: string; name: string });

	const userId = event.streamId.slice("account-".length);

	if (event.type === "AccountOpened") return insertAccount(tx, userId);

	const movement = MOVEMENTS[event.type];
	if (!movement) return;

	const amount = Number(data.amount);
	const row = {
		id: event.id,
		userId,
		type: movement.type,
		amount,
		counterpartyUserId: movement.counterparty ? String(data[movement.counterparty]) : null,
		createdAt: event.created,
		position: event.position?.commit ?? 0n,
	};

	return insertMovement(tx, row, movement.sign * amount);
}

// Catch-up subscription on $all. The checkpoint is saved in the same SQL transaction as the
// projection, so a crash never applies an event twice nor skips one.
export async function runProjector() {
	await migrate();

	const subscription = store.subscribeToAll({
		fromPosition: (await findCheckpoint()) ?? START,
		filter: streamNameFilter({ prefixes: ["users", "account-"] }),
	});

	for await (const { event } of subscription) {
		if (!event?.position) continue;
		const { position } = event;

		await transaction(async (tx) => {
			await project(tx, event);
			await saveCheckpoint(tx, position);
		});
	}
}

export function listUsers() {
	return findUsers();
}

export async function getAccount(userId: string) {
	const balance = await findBalance(userId);

	if (balance === undefined) throw new LedgerError(404, `Account not found for user ${userId}`);

	return { balance, transactions: await findRecentTransactions(userId, RECENT_TRANSACTIONS) };
}

if (import.meta.main) await runProjector();
