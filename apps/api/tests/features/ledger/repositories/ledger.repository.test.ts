import { describe, expect, test } from "bun:test";
import { findSnapshot, loadAccount, SNAPSHOT_EVERY } from "@api/features/ledger/repositories/ledger.repository";
import { createAccount, deposit } from "@api/features/ledger/services/ledger.service";

describe("ledger repository", () => {
	test("rebuilds the account from the latest snapshot plus the events after it", async () => {
		const { accountId } = await createAccount("Snapshot", null);
		const deposits = SNAPSHOT_EVERY + 5;

		for (let index = 0; index < deposits; index++) {
			await deposit(accountId, 1, null);
		}

		// The load before deposit #100 replayed revisions 0..99 (AccountCreated + 99 deposits) and saved them.
		expect(await findSnapshot(accountId)).toEqual({ balance: SNAPSHOT_EVERY - 1, revision: BigInt(SNAPSHOT_EVERY - 1) });

		const account = await loadAccount(accountId);
		expect(account).toMatchObject({ opened: true, balance: deposits, revision: BigInt(deposits) });
	});
});
