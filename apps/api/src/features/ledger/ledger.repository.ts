import {
	type AppendStreamRequest,
	jsonEvent,
	KurrentDBClient,
	StreamNotFoundError,
	WrongExpectedVersionError,
} from "@kurrent/kurrentdb-client";
import { type Account, type AccountEvent, balanceOf, LedgerError } from "@api/features/ledger/ledger.domain";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

export type AccountAppend = { userId: string; revision: bigint; event: AccountEvent };

export type ProcessedRequest = { userId: string; key: string; request: string; balance: number };

const accountStream = (userId: string) => `account-${userId}`;
const idempotencyStream = (userId: string, key: string) => `idempotency-${userId}-${key}`;

async function readStream<T>(streamName: string) {
	const events: (T & { revision: bigint })[] = [];

	try {
		for await (const { event } of store.readStream(streamName)) {
			if (event) events.push({ ...(event as T), revision: event.revision });
		}
	} catch (error) {
		if (!(error instanceof StreamNotFoundError)) throw error;
	}

	return events;
}

// shortcut: replays the whole stream on every command, add snapshots once accounts hold thousands of events.
export async function loadAccount(userId: string): Promise<Account & { revision: bigint }> {
	const events = await readStream<AccountEvent>(accountStream(userId));
	const last = events.at(-1);

	if (!last) throw new LedgerError(404, `Account not found for user ${userId}`);

	return { userId, revision: last.revision, balance: balanceOf(events) };
}

export async function findProcessedRequest(userId: string, key: string) {
	const [event] = await readStream<{ data: { request: string; balance: number } }>(idempotencyStream(userId, key));

	return event?.data;
}

// One atomic append across every touched stream. Returns false when another writer got there first.
export async function appendEvents(appends: AccountAppend[], processed?: ProcessedRequest) {
	const writes: AppendStreamRequest[] = appends.map(({ userId, revision, event }) => ({
		streamName: accountStream(userId),
		expectedState: revision,
		events: [jsonEvent(event)],
	}));

	if (processed) {
		const { userId, key, request, balance } = processed;

		writes.push({
			streamName: idempotencyStream(userId, key),
			expectedState: "no_stream",
			events: [jsonEvent({ type: "RequestProcessed", data: { request, balance } })],
		});
	}

	try {
		await store.multiStreamAppend(writes);
		return true;
	} catch (error) {
		if (error instanceof WrongExpectedVersionError) return false;
		throw error;
	}
}

export async function registerUsers(users: { id: string; name: string }[], usersState: "any" | "no_stream") {
	try {
		await store.multiStreamAppend([
			{
				streamName: "users",
				expectedState: usersState,
				events: users.map((user) => jsonEvent({ type: "UserRegistered", data: user })),
			},
			...users.map((user) => ({
				streamName: accountStream(user.id),
				expectedState: "no_stream" as const,
				events: [jsonEvent({ type: "AccountOpened", data: {} })],
			})),
		]);
		return true;
	} catch (error) {
		if (error instanceof WrongExpectedVersionError) return false;
		throw error;
	}
}
