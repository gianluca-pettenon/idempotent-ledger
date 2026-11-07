import { EventType, type AccountEvent } from "@api/features/ledger/ledger.events";
import { transactions } from "@api/features/projection/projection.store";
import type { Projector } from "@api/features/projection/projections";

const TRANSACTION_TYPE: Record<AccountEvent["type"], string> = {
	[EventType.AccountCreated]: "opened",
	[EventType.MoneyDeposited]: "deposit",
	[EventType.MoneyWithdrawn]: "withdraw",
	[EventType.TransferSent]: "transfer_out",
	[EventType.TransferReceived]: "transfer_in",
};

export const statementsProjector: Projector = {
	name: "statements",
	setup: () => transactions.createIndexes([{ key: { accountId: 1, version: -1 } }]),
	project: (event, recorded) => {
		const { accountId } = event.data;
		const amount = "amount" in event.data ? event.data.amount : event.data.balance;
		const counterpartyAccountId = "counterpartyAccountId" in event.data ? event.data.counterpartyAccountId : undefined;
		const line = { accountId, amount, counterpartyAccountId, type: TRANSACTION_TYPE[event.type], createdAt: recorded.created, version: Number(recorded.revision) };

		return transactions.updateOne({ _id: recorded.id }, { $setOnInsert: line }, { upsert: true });
	},
};
