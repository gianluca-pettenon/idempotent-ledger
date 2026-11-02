import type { TransactionSQL } from "bun";
import { type RecordedEvent, START, streamNameFilter } from "@kurrent/kurrentdb-client";
import { type AccountEvent, AccountEventType, balanceOf } from "@api/features/ledger/domain/ledger.domain";
import { ACCOUNT_STREAM_PREFIX, store } from "@api/features/ledger/repositories/ledger.repository";
import {
	findBalance,
	findCheckpoint,
	findRecentTransactions,
	insertMovement,
	saveCheckpoint,
	transaction,
} from "@api/features/projection/repositories/projection.repository";

const RECENT_TRANSACTIONS = 20;

export enum TransactionType {
	Deposit = "deposit",
	Withdraw = "withdraw",
	TransferOut = "transfer_out",
	TransferIn = "transfer_in",
}

const MOVEMENTS: Record<AccountEventType, { type: TransactionType; counterparty?: "toUserId" | "fromUserId" }> = {
	[AccountEventType.MoneyDeposited]: { type: TransactionType.Deposit },
	[AccountEventType.MoneyWithdrawn]: { type: TransactionType.Withdraw },
	[AccountEventType.TransferSent]: { type: TransactionType.TransferOut, counterparty: "toUserId" },
	[AccountEventType.TransferReceived]: { type: TransactionType.TransferIn, counterparty: "fromUserId" },
};

async function project(tx: TransactionSQL, event: RecordedEvent) {
	const accountEvent = { type: event.type, data: event.data } as AccountEvent;
	const movement = MOVEMENTS[accountEvent.type];
	if (!movement) {
		return;
	}

	const data = accountEvent.data as Record<string, string | number>;
	const row = {
		id: event.id,
		userId: event.streamId.slice(ACCOUNT_STREAM_PREFIX.length),
		type: movement.type,
		amount: accountEvent.data.amount,
		counterpartyUserId: movement.counterparty ? String(data[movement.counterparty]) : null,
		createdAt: event.created,
		position: event.position?.commit ?? 0n,
	};

	return insertMovement(tx, row, balanceOf([accountEvent]));
}

// Catch-up subscription on $all. The checkpoint is saved in the same SQL transaction as the
// projection, so a crash never applies an event twice nor skips one.
export async function runProjector() {
	const subscription = store.subscribeToAll({
		fromPosition: (await findCheckpoint()) ?? START,
		filter: streamNameFilter({ prefixes: [ACCOUNT_STREAM_PREFIX] }),
	});

	for await (const { event } of subscription) {
		if (!event?.position) {
			continue;
		}
		const { position } = event;

		await transaction(async (tx) => {
			await project(tx, event);
			await saveCheckpoint(tx, position);
		});
	}
}

export async function getAccount(userId: string) {
	const balance = await findBalance(userId);

	if (balance === undefined) {
		throw new Error(`Account not found for user ${userId}`, { cause: 404 });
	}

	return { balance, transactions: await findRecentTransactions(userId, RECENT_TRANSACTIONS) };
}

if (import.meta.main) {
	await runProjector();
}
