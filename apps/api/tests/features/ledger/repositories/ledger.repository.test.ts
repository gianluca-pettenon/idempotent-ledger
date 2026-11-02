import { describe, expect, test } from "bun:test";
import { StreamPrefix } from "@api/features/ledger/domain/ledger.events";
import { findSnapshot, loadAccount, SNAPSHOT_EVERY, store } from "@api/features/ledger/repositories/ledger.repository";
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

	test("idempotency records expire, and an expired key is refused instead of applied again", async () => {
		const { accountId } = await createAccount("Expiry", null);
		const key = crypto.randomUUID();
		const keyStream = `${StreamPrefix.Idempotency}${accountId}-${key}`;

		await deposit(accountId, 10, key);
		expect((await store.getStreamMetadata(keyStream)).metadata?.maxAge).toBe(24 * 60 * 60);

		// Shrink the TTL so the record expires within the test.
		await store.setStreamMetadata(keyStream, { maxAge: 1 });
		await Bun.sleep(1500);

		await expect(deposit(accountId, 10, key)).rejects.toThrow("expired");
		expect((await loadAccount(accountId)).balance).toBe(10);
	});
});
