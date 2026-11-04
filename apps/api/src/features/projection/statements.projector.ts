import { EventType, type MovementEvent } from "@api/features/ledger/ledger.events";
import { transactions } from "@api/features/projection/projection.store";
import type { Projector } from "@api/features/projection/projections";

const TRANSACTION_TYPE: Record<MovementEvent["type"], string> = {
	[EventType.MoneyDeposited]: "deposit",
	[EventType.MoneyWithdrawn]: "withdraw",
	[EventType.TransferSent]: "transfer_out",
	[EventType.TransferReceived]: "transfer_in",
};

// One statement line per movement, keyed by the event id so a replayed event changes nothing.
export const statementsProjector: Projector = {
	name: "statements",
	setup: () => transactions.createIndex({ accountId: 1, version: -1 }),
	project: async (event, recorded) => {
		if (event.type === EventType.AccountCreated) {
			return;
		}

		const { accountId, amount } = event.data;
		const counterpartyAccountId = "counterpartyAccountId" in event.data ? event.data.counterpartyAccountId : undefined;
		const line = { accountId, amount, counterpartyAccountId, type: TRANSACTION_TYPE[event.type], createdAt: recorded.created, version: Number(recorded.revision) };

		return transactions.updateOne({ _id: recorded.id }, { $setOnInsert: line }, { upsert: true });
	},
};
