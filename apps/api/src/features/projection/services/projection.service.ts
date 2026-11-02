import { type RecordedEvent, START, streamNameFilter } from "@kurrent/kurrentdb-client";
import { type AccountEvent, AccountEventType, delta } from "@api/features/ledger/domain/ledger.domain";
import { ACCOUNT_STREAM_PREFIX, store } from "@api/features/ledger/repositories/ledger.repository";
import {
	applyMovement,
	createIndexes,
	findAccount,
	findAccounts,
	findCheckpoint,
	findOwnerName,
	findRecentTransactions,
	insertAccount,
	saveCheckpoint,
} from "@api/features/projection/repositories/projection.repository";

const RECENT_TRANSACTIONS = 20;

export enum TransactionType {
	Deposit = "deposit",
	Withdraw = "withdraw",
	TransferOut = "transfer_out",
	TransferIn = "transfer_in",
}

const TRANSACTION_TYPES: Record<Exclude<AccountEventType, AccountEventType.AccountCreated>, TransactionType> = {
	[AccountEventType.MoneyDeposited]: TransactionType.Deposit,
	[AccountEventType.MoneyWithdrawn]: TransactionType.Withdraw,
	[AccountEventType.TransferSent]: TransactionType.TransferOut,
	[AccountEventType.TransferReceived]: TransactionType.TransferIn,
};

// The read model adds what the event does not carry: the balance, and the counterparty's name.
async function project(event: RecordedEvent) {
	const accountEvent = { type: event.type, data: event.data } as AccountEvent;
	const version = Number(event.revision);

	if (accountEvent.type === AccountEventType.AccountCreated) {
		const { accountId, ownerName } = accountEvent.data;

		return insertAccount({ _id: accountId, ownerName, balance: 0, version });
	}

	const { data } = accountEvent;
	const counterpartyAccountId = "counterpartyAccountId" in data ? data.counterpartyAccountId : undefined;

	return applyMovement(
		{
			_id: event.id,
			accountId: data.accountId,
			type: TRANSACTION_TYPES[accountEvent.type],
			amount: data.amount,
			counterpartyAccountId,
			counterpartyName: counterpartyAccountId && (await findOwnerName(counterpartyAccountId)),
			createdAt: event.created,
			version,
		},
		delta(accountEvent),
	);
}

// Catch-up subscription on $all. Projection writes are idempotent, so a crash between an event
// and its checkpoint only replays that event, harmlessly.
export async function runProjector() {
	await createIndexes();

	const subscription = store.subscribeToAll({
		fromPosition: (await findCheckpoint()) ?? START,
		filter: streamNameFilter({ prefixes: [ACCOUNT_STREAM_PREFIX] }),
	});

	for await (const { event } of subscription) {
		if (!event?.position) {
			continue;
		}

		await project(event);
		await saveCheckpoint(event.position);
	}
}

export function listAccounts() {
	return findAccounts();
}

export async function getAccount(accountId: string) {
	const account = await findAccount(accountId);

	if (!account) {
		throw new Error(`Account ${accountId} not found`, { cause: 404 });
	}

	return { balance: account.balance, transactions: await findRecentTransactions(accountId, RECENT_TRANSACTIONS) };
}

if (import.meta.main) {
	await runProjector();
}
