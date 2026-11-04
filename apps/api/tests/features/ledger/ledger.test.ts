import { beforeAll, describe, expect, test } from "bun:test";
import { jsonEvent, NO_STREAM } from "@kurrent/kurrentdb-client";
import { EventType } from "@api/features/ledger/ledger.events";
import { ACCOUNT_STREAM, loadAccount, store } from "@api/features/ledger/ledger.store";
import { balancesProjector } from "@api/features/projection/balances.projector";
import { runProjector } from "@api/features/projection/projector";
import { statementsProjector } from "@api/features/projection/statements.projector";
import { app } from "@api/server";

async function post(path: string, body: unknown, idempotencyKey?: string) {
	const response = await app.handle(
		new Request(`http://localhost/api${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }) },
			body: JSON.stringify(body),
		}),
	);

	return { status: response.status, body: ((await response.json()) as any).data };
}

async function get(path: string) {
	const response = await app.handle(new Request(`http://localhost/api${path}`));

	return ((await response.json()) as any).data;
}

// The read model is eventually consistent: poll until the projectors have applied the events.
async function readModel(accountId: string, balance: number, lines: number) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const account = await get(`/accounts/${accountId}`);

		if (account?.balance === balance && account.transactions.length === lines) {
			return account;
		}
		await Bun.sleep(20);
	}

	throw new Error("Read model never caught up");
}

// Accounts come pre-registered, as the external migration does.
async function openAccount(ownerName: string) {
	const accountId = Bun.randomUUIDv7();
	const event = jsonEvent({ type: EventType.AccountCreated, data: { accountId, ownerName } });
	await store.appendToStream(`${ACCOUNT_STREAM}${accountId}`, event, { streamState: NO_STREAM });

	return accountId;
}

const deposit = (accountId: string, amount: number, key?: string) => post(`/accounts/${accountId}/deposits`, { amount }, key);
const withdraw = (accountId: string, amount: number) => post(`/accounts/${accountId}/withdrawals`, { amount });

beforeAll(() => {
	runProjector(balancesProjector);
	runProjector(statementsProjector);
});

describe("ledger", () => {
	test("deposit and withdraw are materialized in the read model", async () => {
		const alice = await openAccount("Alice");

		expect((await deposit(alice, 100)).body).toEqual({ balance: 100, outcome: "processed" });
		expect((await withdraw(alice, 30)).body.balance).toBe(70);

		const account = await readModel(alice, 70, 2);
		expect(account.transactions.map((line: { type: string }) => line.type)).toEqual(["withdraw", "deposit"]);
	});

	test("rejects a debit without funds", async () => {
		const bob = await openAccount("Bob");

		expect((await withdraw(bob, 1)).status).toBe(422);
	});

	test("transfer moves money between both accounts atomically", async () => {
		const [from, to] = await Promise.all([openAccount("From"), openAccount("To")]);
		await deposit(from, 50);

		expect((await post("/transfers", { fromAccountId: from, toAccountId: to, amount: 20 })).body.balance).toBe(30);
		expect((await post("/transfers", { fromAccountId: from, toAccountId: to, amount: 31 })).status).toBe(422);

		const received = await readModel(to, 20, 1);
		expect(received.transactions[0]).toMatchObject({ type: "transfer_in", counterpartyAccountId: from, counterpartyName: "From" });
	});

	test("without a key, every request is applied", async () => {
		const user = await openAccount("NoKey");
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user, 10)));

		expect(results.every((result) => result.body.outcome === "processed")).toBe(true);
		await readModel(user, 80, 8);
	});

	test("with a key, concurrent retries are applied once", async () => {
		const user = await openAccount("Key");
		const key = crypto.randomUUID();
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user, 10, key)));

		expect(results.filter((result) => result.body.outcome === "processed")).toHaveLength(1);
		expect(results.every((result) => result.body.balance === 10)).toBe(true);
		await readModel(user, 10, 1);
	});

	test("the balance is rebuilt from the latest snapshot", async () => {
		const user = await openAccount("Snapshot");

		for (let i = 0; i < 120; i++) {
			await deposit(user, 1);
		}

		expect((await loadAccount(user)).balance).toBe(120);
		expect((await withdraw(user, 121)).status).toBe(422);
	});
});
