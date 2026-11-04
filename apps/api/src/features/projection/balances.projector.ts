import { EventType } from "@api/features/ledger/ledger.events";
import { accounts } from "@api/features/projection/projection.store";
import type { Projector } from "@api/features/projection/projections";

// Accounts with their balance. The newest revision wins, so events may arrive in any order or twice.
export const balancesProjector: Projector = {
	name: "balances",
	project: (event, recorded) => {
		const version = Number(recorded.revision);
		const isNewer = { $gt: [version, { $ifNull: ["$version", -1] }] };
		const owner = event.type === EventType.AccountCreated ? { ownerName: event.data.ownerName } : {};
		const balance = event.type === EventType.AccountCreated ? 0 : event.data.balance;

		return accounts.updateOne(
			{ _id: event.data.accountId },
			[{ $set: { ...owner, balance: { $cond: [isNewer, balance, "$balance"] }, version: { $max: ["$version", version] } } }],
			{ upsert: true },
		);
	},
};
