import { EventType } from "@api/features/ledger/ledger.events";
import { accounts } from "@api/features/projection/projection.store";
import type { Projector } from "@api/features/projection/projections";

export const accountsProjector: Projector = {
	name: "accounts",
	project: (event) => {
		if (event.type !== EventType.AccountCreated) {
			return Promise.resolve();
		}

		return accounts.updateOne(
			{ _id: event.data.accountId },
			{ $set: { ownerName: event.data.ownerName }, $unset: { balance: "", version: "" } },
			{ upsert: true },
		);
	},
};
