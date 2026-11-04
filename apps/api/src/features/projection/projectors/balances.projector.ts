import { EventType } from "@api/features/ledger/ledger.events";
import { accounts } from "@api/features/projection/projection.store";
import type { Projector } from "@api/features/projection/projections";

export const balancesProjector: Projector = {
	name: "balances",
	project: (event, recorded) => {
		const version = Number(recorded.revision);
		const isNewer = { $gt: [version, { $ifNull: ["$version", -1] }] };
		const owner = event.type === EventType.AccountCreated ? { ownerName: event.data.ownerName } : {};

		return accounts.updateOne(
			{ _id: event.data.accountId },
			[{ $set: { ...owner, balance: { $cond: [isNewer, event.data.balance, "$balance"] }, version: { $max: ["$version", version] } } }],
			{ upsert: true },
		);
	},
};
