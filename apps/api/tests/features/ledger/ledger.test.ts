import { beforeAll, describe, expect, test } from "bun:test";
import { runProjector } from "@api/features/projection/services/projection.service";
import { seed } from "@api/seed";
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

// The read model is eventually consistent: poll until the projector has applied the events.
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean) {
	for (let attempt = 0; attempt < 100; attempt++) {
		const value = await read();

		if (done(value)) {
			return value;
		}
		await Bun.sleep(20);
	}

	throw new Error("Read model never caught up");
}

const account = (accountId: string, balance: number) =>
	eventually(
		() => get(`/accounts/${accountId}`),
		(account) => account?.balance === balance,
	);

async function openAccount(ownerName: string) {
	const { body } = await post("/accounts", { ownerName });

	return body.accountId as string;
}

beforeAll(() => {
	runProjector();
});

const deposit = (accountId: string, amount: unknown, key?: string) => post(`/accounts/${accountId}/deposits`, { amount }, key);
const withdraw = (accountId: string, amount: number) => post(`/accounts/${accountId}/withdrawals`, { amount });

describe("ledger", () => {
	test("the seed opens the default accounts once, however often it runs", async () => {
		await seed();
		await seed();

		const accounts = await eventually(
			() => get("/accounts"),
			(accounts: { name: string }[]) => accounts.some((account) => account.name === "User D"),
		);

		expect(accounts.filter((account: { name: string }) => account.name.startsWith("User "))).toHaveLength(4);
	});

	test("a new account starts at zero in the read model", async () => {
		const result = await post("/accounts", { ownerName: "Zero" });

		expect(result.status).toBe(201);
		expect(result.body).toMatchObject({ balance: 0, outcome: "processed" });
		expect((await account(result.body.accountId, 0)).transactions).toEqual([]);
		expect((await post("/accounts", { ownerName: " " })).status).toBe(422);
	});

	test("deposit, withdraw and statement", async () => {
		const alice = await openAccount("Alice");

		expect((await deposit(alice, 100)).body).toEqual({ balance: 100, outcome: "processed" });
		expect((await withdraw(alice, 30)).body.balance).toBe(70);

		const statement = await account(alice, 70);
		expect(statement.transactions.map((tx: { type: string }) => tx.type)).toEqual(["withdraw", "deposit"]);
	});

	test("rejects overdraft, invalid amounts and unknown accounts", async () => {
		const bob = await openAccount("Bob");

		expect((await withdraw(bob, 1)).status).toBe(422);
		expect((await deposit(bob, 0)).status).toBe(422);
		expect((await deposit(bob, 1.5)).status).toBe(422);
		expect((await deposit(bob, "10")).status).toBe(422);
		expect((await deposit(Bun.randomUUIDv7(), 10)).status).toBe(404);
	});

	test("transfer moves money atomically between both streams", async () => {
		const [from, to] = await Promise.all([openAccount("From"), openAccount("To")]);
		await deposit(from, 50);

		const result = await post("/transfers", { fromAccountId: from, toAccountId: to, amount: 20 });
		expect(result.body.balance).toBe(30);

		const received = await account(to, 20);
		expect(received.transactions[0]).toMatchObject({ type: "transfer_in", counterpartyAccountId: from, counterpartyName: "From" });

		expect((await post("/transfers", { fromAccountId: from, toAccountId: to, amount: 31 })).status).toBe(422);
		expect((await post("/transfers", { fromAccountId: from, toAccountId: from, amount: 1 })).status).toBe(422);
		expect((await post("/transfers", { fromAccountId: from, toAccountId: Bun.randomUUIDv7(), amount: 1 })).status).toBe(404);
	});

	test("concurrent requests without a key are all applied, none lost", async () => {
		const user = await openAccount("Concurrent");
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user, 10)));

		expect(results.every((result) => result.body.outcome === "processed")).toBe(true);
		await account(user, 80);
	});

	test("concurrent retries with the same key are applied once", async () => {
		const user = await openAccount("Idempotent");
		const key = crypto.randomUUID();
		const results = await Promise.all(Array.from({ length: 8 }, () => deposit(user, 10, key)));
		const outcomes = results.map((result) => result.body.outcome);

		expect(outcomes.filter((outcome) => outcome === "processed")).toHaveLength(1);
		expect(results.every((result) => result.body.balance === 10)).toBe(true);
		await account(user, 10);
		expect((await deposit(user, 99, key)).status).toBe(409);
	});
});
