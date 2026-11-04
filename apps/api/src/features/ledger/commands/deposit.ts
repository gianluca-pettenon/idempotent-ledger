import { EventType } from "@api/features/ledger/ledger.events";
import { loadAccount } from "@api/features/ledger/ledger.store";
import { execute } from "@api/features/ledger/commands/command";

export const deposit = (accountId: string, amount: number, key: string | null) =>
	execute(key, async () => {
		const account = await loadAccount(accountId);
		const balance = account.balance + amount;

		return { appends: [{ account, event: { type: EventType.MoneyDeposited, data: { accountId, amount, balance } } }], balance };
	});
