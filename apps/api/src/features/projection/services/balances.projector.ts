import { delta } from "@api/features/ledger/domain/ledger.domain";
import { EventType } from "@api/features/ledger/domain/ledger.events";
import { applyBalance, insertAccount } from "@api/features/projection/repositories/projection.repository";
import { type Projector, ProjectorName, runProjector } from "@api/features/projection/services/projection.service";

// Accounts and their balances: what the event does not carry is the running total.
export const balancesProjector: Projector = {
	name: ProjectorName.Balances,
	project: async (event, recorded) => {
		const version = Number(recorded.revision);

		if (event.type === EventType.AccountCreated) {
			return insertAccount({ _id: event.data.accountId, ownerName: event.data.ownerName, balance: 0, version });
		}

		return applyBalance(event.data.accountId, version, delta(event));
	},
};

if (import.meta.main) {
	await runProjector(balancesProjector);
}
