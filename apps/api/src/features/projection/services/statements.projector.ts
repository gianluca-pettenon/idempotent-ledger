import { EventType, type MovementType } from "@api/features/ledger/domain/ledger.events";
import { createTransactionIndexes, insertTransaction } from "@api/features/projection/repositories/projection.repository";
import { type Projector, ProjectorName, runProjector } from "@api/features/projection/services/projection.service";

export enum TransactionType {
	Deposit = "deposit",
	Withdraw = "withdraw",
	TransferOut = "transfer_out",
	TransferIn = "transfer_in",
}

const TRANSACTION_TYPES: Record<MovementType, TransactionType> = {
	[EventType.MoneyDeposited]: TransactionType.Deposit,
	[EventType.MoneyWithdrawn]: TransactionType.Withdraw,
	[EventType.TransferSent]: TransactionType.TransferOut,
	[EventType.TransferReceived]: TransactionType.TransferIn,
};

// One statement line per movement; opening an account moves no money, so it adds no line.
export const statementsProjector: Projector = {
	name: ProjectorName.Statements,
	setup: createTransactionIndexes,
	project: async (event, recorded) => {
		if (event.type === EventType.AccountCreated) {
			return;
		}

		const { data } = event;

		return insertTransaction({
			_id: recorded.id,
			accountId: data.accountId,
			type: TRANSACTION_TYPES[event.type],
			amount: data.amount,
			counterpartyAccountId: "counterpartyAccountId" in data ? data.counterpartyAccountId : undefined,
			createdAt: recorded.created,
			version: Number(recorded.revision),
		});
	},
};

if (import.meta.main) {
	await runProjector(statementsProjector);
}
