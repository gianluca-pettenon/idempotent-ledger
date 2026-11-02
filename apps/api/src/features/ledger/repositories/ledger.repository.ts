import {
	type AppendStreamRequest,
	jsonEvent,
	KurrentDBClient,
	NO_STREAM,
	StreamNotFoundError,
	WrongExpectedVersionError,
} from "@kurrent/kurrentdb-client";
import { type Account, type AccountEvent, balanceOf } from "@api/features/ledger/domain/ledger.domain";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

type Revision = bigint | typeof NO_STREAM;

export type AccountAppend = { userId: string; revision: Revision; event: AccountEvent };

export type ProcessedRequest = { userId: string; key: string; request: string; balance: number };

export const ACCOUNT_STREAM_PREFIX = "account-";
const REQUEST_PROCESSED = "RequestProcessed";

const accountStream = (userId: string) => `${ACCOUNT_STREAM_PREFIX}${userId}`;
const idempotencyStream = (userId: string, key: string) => `idempotency-${userId}-${key}`;

async function readStream<T>(streamName: string) {
	const events: (T & { revision: bigint })[] = [];

	try {
		for await (const { event } of store.readStream(streamName)) {
			if (event) {
				events.push({ ...(event as T), revision: event.revision });
			}
		}
	} catch (error) {
		if (!(error instanceof StreamNotFoundError)) {
			throw error;
		}
	}

	return events;
}

// An account with no events yet is an empty stream: balance 0, appended to as NO_STREAM.
// shortcut: replays the whole stream on every command, add snapshots once accounts hold thousands of events.
export async function loadAccount(userId: string): Promise<Account & { revision: Revision }> {
	const events = await readStream<AccountEvent>(accountStream(userId));

	return { userId, revision: events.at(-1)?.revision ?? NO_STREAM, balance: balanceOf(events) };
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
			expectedState: NO_STREAM,
			events: [jsonEvent({ type: REQUEST_PROCESSED, data: { request, balance } })],
		});
	}

	try {
		await store.multiStreamAppend(writes);
		return true;
	} catch (error) {
		if (error instanceof WrongExpectedVersionError) {
			return false;
		}
		throw error;
	}
}
