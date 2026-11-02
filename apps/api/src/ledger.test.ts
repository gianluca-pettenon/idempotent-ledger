import { describe, expect, test } from "bun:test";
import { openAccounts } from "@api/ledger";
import { app } from "@api/server";

async function post(path: string, body: unknown, idempotencyKey?: string) {
	const response = await app.handle(
		new Request(`http://localhost/api${path}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }) },
			body: JSON.stringify(body),
		}),
	);

	return { status: response.status, body: (await response.json()) as any };
}

async function account(userId: string) {
	const response = await app.handle(new Request(`http://localhost/api/accounts/${userId}`));

	return ((await response.json()) as any).account;
}

const deposit = (userId: string, amount: number, key?: string) =>
	post(`/accounts/${userId}/transactions`, { type: "deposit", amount }, key);

describe("ledger", () => {
	test("deposit, withdraw and statement", async () => {
		const [alice] = await openAccounts(["Alice"]);

		expect((await deposit(alice.id, 100)).body).toEqual({ balance: 100, meta: { outcome: "processed" } });
		expect((await post(`/accounts/${alice.id}/transactions`, { type: "withdraw", amount: 30 })).body.balance).toBe(70);

		const statement = await account(alice.id);
		expect(statement.balance).toBe(70);
		expect(statement.transactions.map((tx: { type: string }) => tx.type)).toEqual(["withdraw", "deposit"]);
	});

	test("rejects overdraft, invalid amounts and unknown accounts", async () => {
		const [bob] = await openAccounts(["Bob"]);

		expect((await post(`/accounts/${bob.id}/transactions`, { type: "withdraw", amount: 1 })).status).toBe(422);
		expect((await deposit(bob.id, 0)).status).toBe(422);
		expect((await deposit(bob.id, 1.5)).status).toBe(422);
		expect((await deposit(Bun.randomUUIDv7(), 10)).status).toBe(404);
	});

	test("transfer moves money atomically between both streams", async () => {
		const [from, to] = await openAccounts(["From", "To"]);
		await deposit(from.id, 50);

		const result = await post("/transfers", { fromUserId: from.id, toUserId: to.id, amount: 20 });
		expect(result.body.balance).toBe(30);

		const received = await account(to.id);
		expect(received.balance).toBe(20);
		expect(received.transactions[0]).toMatchObject({ type: "transfer_in", counterpartyName: "From" });

		expect((await post("/transfers", { fromUserId: from.id, toUserId: to.id, amount: 31 })).status).toBe(422);
		expect((await post("/transfers", { fromUserId: from.id, toUserId: from.id, amount: 1 })).status).toBe(422);
	});

	test("concurrent requests without a key are all applied, none lost", async () => {
		const [user] = await openAccounts(["Concurrent"]);
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user.id, 10)));

		expect(results.every((result) => result.body.meta.outcome === "processed")).toBe(true);
		expect((await account(user.id)).balance).toBe(80);
	});

	test("concurrent retries with the same key are applied once", async () => {
		const [user] = await openAccounts(["Idempotent"]);
		const key = crypto.randomUUID();
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user.id, 10, key)));
		const outcomes = results.map((result) => result.body.meta.outcome);

		expect(outcomes.filter((outcome) => outcome === "processed")).toHaveLength(1);
		expect(results.every((result) => result.body.balance === 10)).toBe(true);
		expect((await account(user.id)).balance).toBe(10);
		expect((await deposit(user.id, 99, key)).status).toBe(409);
	});
});
