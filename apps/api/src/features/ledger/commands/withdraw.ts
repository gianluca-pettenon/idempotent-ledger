import { EventType } from "@api/features/ledger/ledger.events";
import { loadAccount } from "@api/features/ledger/ledger.store";
import { assertFunds, execute } from "@api/features/ledger/commands/command";

export const withdraw = (accountId: string, amount: number, key: string | null) =>
	execute(key, async () => {
		const account = await loadAccount(accountId);
		assertFunds(account, amount);
		const balance = account.balance - amount;

		return { appends: [{ account, event: { type: EventType.MoneyWithdrawn, data: { accountId, amount, balance } } }], balance };
	});
