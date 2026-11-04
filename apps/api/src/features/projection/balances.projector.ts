import { delta, EventType } from "@api/features/ledger/ledger.events";
import { accounts } from "@api/features/projection/projection.store";
import { type Projector, runProjector } from "@api/features/projection/projector";

// Accounts with their running balance. The version guard makes a replayed event change nothing.
export const balancesProjector: Projector = {
	name: "balances",
	project: (event, recorded) => {
		const version = Number(recorded.revision);

		if (event.type === EventType.AccountCreated) {
			const { accountId, ownerName } = event.data;

			return accounts.updateOne({ _id: accountId }, { $setOnInsert: { ownerName, balance: 0, version } }, { upsert: true });
		}

		return accounts.updateOne({ _id: event.data.accountId, version: { $lt: version } }, { $inc: { balance: delta(event) }, $set: { version } });
	},
};

if (import.meta.main) {
	await runProjector(balancesProjector);
}
