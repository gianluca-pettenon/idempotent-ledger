import {
	type AppendStreamRequest,
	jsonEvent,
	KurrentDBClient,
	StreamNotFoundError,
	WrongExpectedVersionError,
} from "@kurrent/kurrentdb-client";
import type { OperationKind } from "@banking-ledger/shared";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

const USERS_STREAM = "users";
const DEFAULT_USERS = ["User A", "User B", "User C", "User D"];
const RECENT_TRANSACTIONS = 20;
const MAX_ATTEMPTS = 20;

export type User = { id: string; name: string };

type AccountEvent =
	| { type: "AccountOpened"; data: Record<string, never> }
	| { type: "MoneyDeposited"; data: { amount: number } }
	| { type: "MoneyWithdrawn"; data: { amount: number } }
	| { type: "TransferSent"; data: { transferId: string; toUserId: string; amount: number } }
	| { type: "TransferReceived"; data: { transferId: string; fromUserId: string; amount: number } };

type RecordedAccountEvent = AccountEvent & { id: string; created: Date };

type Account = { userId: string; revision: bigint; balance: number; events: RecordedAccountEvent[] };

type Outcome = "processed" | "duplicate";

type IdempotentRequest = { type: OperationKind; userId: string; toUserId?: string; amount: number };

type Decision = { appends: { userId: string; revision: bigint; event: AccountEvent }[]; balance: number };

export class LedgerError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

const accountStream = (userId: string) => `account-${userId}`;

async function readStream<T>(streamName: string) {
	const events: (T & { id: string; created: Date; revision: bigint })[] = [];

	try {
		for await (const { event } of store.readStream(streamName)) {
			if (event) events.push({ ...(event as T), id: event.id, created: event.created, revision: event.revision });
		}
	} catch (error) {
		if (!(error instanceof StreamNotFoundError)) throw error;
	}

	return events;
}

export function balanceOf(events: AccountEvent[]) {
	return events.reduce((balance, event) => {
		switch (event.type) {
			case "MoneyDeposited":
			case "TransferReceived":
				return balance + event.data.amount;
			case "MoneyWithdrawn":
			case "TransferSent":
				return balance - event.data.amount;
			default:
				return balance;
		}
	}, 0);
}

// shortcut: replays the whole stream on every read, add snapshots once accounts hold thousands of events.
async function loadAccount(userId: string): Promise<Account> {
	const events = await readStream<AccountEvent>(accountStream(userId));
	const last = events.at(-1);

	if (!last) throw new LedgerError(404, `Account not found for user ${userId}`);

	return { userId, revision: last.revision, balance: balanceOf(events), events };
}

function assertFunds(account: Account, amount: number) {
	if (account.balance < amount) throw new LedgerError(422, `Account ${account.userId} has insufficient balance`);
}

// Retries on optimistic-concurrency conflicts. With a key, the idempotency stream is appended in the
// same atomic write as the money events, so a request is recorded exactly when its effect is.
async function execute(request: IdempotentRequest, key: string | null, decide: () => Promise<Decision>) {
	const requestJson = JSON.stringify(request);
	const idempotencyStream = key && `idempotency-${request.userId}-${key}`;

	for (let attempt = 1; ; attempt++) {
		if (idempotencyStream) {
			const [previous] = await readStream<{ data: { request: string; balance: number } }>(idempotencyStream);

			if (previous) {
				if (previous.data.request !== requestJson) {
					throw new LedgerError(409, `Idempotency-Key "${key}" was already used with a different request`);
				}

				return { balance: previous.data.balance, outcome: "duplicate" as Outcome };
			}
		}

		const { appends, balance } = await decide();
		const writes: AppendStreamRequest[] = appends.map(({ userId, revision, event }) => ({
			streamName: accountStream(userId),
			expectedState: revision,
			events: [jsonEvent(event)],
		}));

		if (idempotencyStream) {
			writes.push({
				streamName: idempotencyStream,
				expectedState: "no_stream",
				events: [jsonEvent({ type: "RequestProcessed", data: { request: requestJson, balance } })],
			});
		}

		try {
			await store.multiStreamAppend(writes);

			return { balance, outcome: "processed" as Outcome };
		} catch (error) {
			if (!(error instanceof WrongExpectedVersionError)) throw error;
			if (attempt === MAX_ATTEMPTS) throw new LedgerError(409, "Account is under heavy contention, retry later");
		}
	}
}

export function deposit(userId: string, amount: number, key: string | null) {
	return execute({ type: "deposit", userId, amount }, key, async () => {
		const account = await loadAccount(userId);

		return {
			appends: [{ userId, revision: account.revision, event: { type: "MoneyDeposited", data: { amount } } }],
			balance: account.balance + amount,
		};
	});
}

export function withdraw(userId: string, amount: number, key: string | null) {
	return execute({ type: "withdraw", userId, amount }, key, async () => {
		const account = await loadAccount(userId);
		assertFunds(account, amount);

		return {
			appends: [{ userId, revision: account.revision, event: { type: "MoneyWithdrawn", data: { amount } } }],
			balance: account.balance - amount,
		};
	});
}

export function transfer(fromUserId: string, toUserId: string, amount: number, key: string | null) {
	if (fromUserId === toUserId) throw new LedgerError(422, "Cannot transfer to the same account");

	return execute({ type: "transfer", userId: fromUserId, toUserId, amount }, key, async () => {
		const [from, to] = await Promise.all([loadAccount(fromUserId), loadAccount(toUserId)]);
		const transferId = Bun.randomUUIDv7();
		assertFunds(from, amount);

		return {
			appends: [
				{ userId: fromUserId, revision: from.revision, event: { type: "TransferSent", data: { transferId, toUserId, amount } } },
				{ userId: toUserId, revision: to.revision, event: { type: "TransferReceived", data: { transferId, fromUserId, amount } } },
			],
			balance: from.balance - amount,
		};
	});
}

export async function listUsers(): Promise<User[]> {
	return (await readStream<{ data: User }>(USERS_STREAM)).map(({ data }) => data);
}

export async function getAccount(userId: string) {
	const [account, users] = await Promise.all([loadAccount(userId), listUsers()]);
	const nameOf = (id: string) => users.find((user) => user.id === id)?.name;

	const transactions = account.events
		.filter((event) => event.type !== "AccountOpened")
		.slice(-RECENT_TRANSACTIONS)
		.reverse()
		.map((event) => {
			const base = { id: event.id, amount: event.data.amount, createdAt: event.created.toISOString() };

			switch (event.type) {
				case "MoneyDeposited":
					return { ...base, type: "deposit" };
				case "MoneyWithdrawn":
					return { ...base, type: "withdraw" };
				case "TransferSent":
					return { ...base, type: "transfer_out", counterpartyUserId: event.data.toUserId, counterpartyName: nameOf(event.data.toUserId) };
				case "TransferReceived":
					return { ...base, type: "transfer_in", counterpartyUserId: event.data.fromUserId, counterpartyName: nameOf(event.data.fromUserId) };
			}
		});

	return { balance: account.balance, transactions };
}

export async function openAccounts(names: string[], usersState: "any" | "no_stream" = "any") {
	const users = names.map((name) => ({ id: Bun.randomUUIDv7(), name }));

	await store.multiStreamAppend([
		{
			streamName: USERS_STREAM,
			expectedState: usersState,
			events: users.map((user) => jsonEvent({ type: "UserRegistered", data: user })),
		},
		...users.map((user) => ({
			streamName: accountStream(user.id),
			expectedState: "no_stream" as const,
			events: [jsonEvent({ type: "AccountOpened", data: {} })],
		})),
	]);

	return users;
}

export async function seedDefaultUsers() {
	try {
		await openAccounts(DEFAULT_USERS, "no_stream");
	} catch (error) {
		if (!(error instanceof WrongExpectedVersionError)) throw error;
	}
}
