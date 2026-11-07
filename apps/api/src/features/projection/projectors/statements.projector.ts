import { EventType, type Movement, type MovementEvent } from "@api/features/ledger/ledger.events";
import { transactions } from "@api/features/projection/projection.store";
import type { Projector } from "@api/features/projection/projections";

const TRANSACTION_TYPE: Record<MovementEvent["type"], string> = {
	[EventType.MoneyDeposited]: "deposit",
	[EventType.MoneyWithdrawn]: "withdraw",
	[EventType.TransferSent]: "transfer_out",
	[EventType.TransferReceived]: "transfer_in",
};

export const statementsProjector: Projector = {
	name: "statements",
	setup: () => transactions.createIndexes([{ key: { accountId: 1, version: -1 } }]),
	project: async (event, recorded) => {
		const type = TRANSACTION_TYPE[event.type as MovementEvent["type"]];

		if (!type) {
			return;
		}

		const { accountId, amount } = event.data as Movement;
		const counterpartyAccountId = "counterpartyAccountId" in event.data ? event.data.counterpartyAccountId : undefined;
		const line = { accountId, amount, counterpartyAccountId, type, createdAt: recorded.created, version: Number(recorded.revision) };

		return transactions.updateOne({ _id: recorded.id }, { $setOnInsert: line }, { upsert: true });
	},
};
