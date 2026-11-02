import { beforeAll, describe, expect, test } from "bun:test";
import { migrate, sql } from "@api/db/db";
import { runProjector } from "@api/features/projection/projection.service";
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

// The read model is eventually consistent: poll until the projector has applied the events.
async function account(userId: string, balance: number) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const response = await app.handle(new Request(`http://localhost/api/accounts/${userId}`));
		const { data: account } = (await response.json()) as any;

		if (account?.balance === balance) return account;
		await Bun.sleep(20);
	}

	throw new Error(`Read model never reached balance ${balance} for ${userId}`);
}

async function openAccounts(names: string[]) {
	return sql<{ id: string; name: string }[]>`INSERT INTO users ${sql(names.map((name) => ({ name })))} RETURNING id, name`;
}

beforeAll(async () => {
	await migrate();
	runProjector();
});

const deposit = (userId: string, amount: unknown, key?: string) => post(`/accounts/${userId}/deposits`, { amount }, key);
const withdraw = (userId: string, amount: number) => post(`/accounts/${userId}/withdrawals`, { amount });

describe("ledger", () => {
	test("migrations seed the default users", async () => {
		const response = await app.handle(new Request("http://localhost/api/users"));
		const { data: users } = (await response.json()) as any;

		expect(users.map((user: { name: string }) => user.name)).toEqual(expect.arrayContaining(["User A", "User D"]));
	});

	test("deposit, withdraw and statement", async () => {
		const [alice] = await openAccounts(["Alice"]);

		expect((await deposit(alice.id, 100)).body).toEqual({ balance: 100, outcome: "processed" });
		expect((await withdraw(alice.id, 30)).body.balance).toBe(70);

		const statement = await account(alice.id, 70);
		expect(statement.transactions.map((tx: { type: string }) => tx.type)).toEqual(["withdraw", "deposit"]);
	});

	test("rejects overdraft, invalid amounts and unknown accounts", async () => {
		const [bob] = await openAccounts(["Bob"]);

		expect((await withdraw(bob.id, 1)).status).toBe(422);
		expect((await deposit(bob.id, 0)).status).toBe(422);
		expect((await deposit(bob.id, 1.5)).status).toBe(422);
		expect((await deposit(bob.id, "10")).status).toBe(422);
		expect((await deposit(Bun.randomUUIDv7(), 10)).status).toBe(404);
	});

	test("transfer moves money atomically between both streams", async () => {
		const [from, to] = await openAccounts(["From", "To"]);
		await deposit(from.id, 50);

		const result = await post("/transfers", { fromUserId: from.id, toUserId: to.id, amount: 20 });
		expect(result.body.balance).toBe(30);

		const received = await account(to.id, 20);
		expect(received.transactions[0]).toMatchObject({ type: "transfer_in", counterpartyName: "From" });

		expect((await post("/transfers", { fromUserId: from.id, toUserId: to.id, amount: 31 })).status).toBe(422);
		expect((await post("/transfers", { fromUserId: from.id, toUserId: from.id, amount: 1 })).status).toBe(422);
	});

	test("concurrent requests without a key are all applied, none lost", async () => {
		const [user] = await openAccounts(["Concurrent"]);
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user.id, 10)));

		expect(results.every((result) => result.body.outcome === "processed")).toBe(true);
		await account(user.id, 80);
	});

	test("concurrent retries with the same key are applied once", async () => {
		const [user] = await openAccounts(["Idempotent"]);
		const key = crypto.randomUUID();
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user.id, 10, key)));
		const outcomes = results.map((result) => result.body.outcome);

		expect(outcomes.filter((outcome) => outcome === "processed")).toHaveLength(1);
		expect(results.every((result) => result.body.balance === 10)).toBe(true);
		await account(user.id, 10);
		expect((await deposit(user.id, 99, key)).status).toBe(409);
	});
});
