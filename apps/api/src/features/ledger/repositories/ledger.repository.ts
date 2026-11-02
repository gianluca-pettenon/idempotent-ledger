import {
	type AppendStreamRequest,
	jsonEvent,
	KurrentDBClient,
	NO_STREAM,
	StreamNotFoundError,
	WrongExpectedVersionError,
} from "@kurrent/kurrentdb-client";
import { type Account, type AccountEvent, balanceOf } from "@api/features/ledger/domain/ledger.domain";
import { EventType, StreamPrefix } from "@api/features/ledger/domain/ledger.events";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

type Revision = bigint | typeof NO_STREAM;

export type AccountAppend = { accountId: string; revision: Revision; event: AccountEvent };

export type ProcessedRequest = { accountId: string; key: string; request: string; response: object };

const accountStream = (accountId: string) => `${StreamPrefix.Account}${accountId}`;
const idempotencyStream = (accountId: string, key: string) => `${StreamPrefix.Idempotency}${accountId}-${key}`;

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

// The account is rebuilt from its event stream only, never from the read model.
// It exists once its stream holds AccountCreated; until then it is appended to as NO_STREAM.
export async function loadAccount(accountId: string): Promise<Account & { revision: Revision }> {
	const events = await readStream<AccountEvent>(accountStream(accountId));
	const lastRevision = events.at(-1)?.revision;

	return { accountId, opened: lastRevision !== undefined, revision: lastRevision ?? NO_STREAM, balance: balanceOf(events) };
}

export async function findProcessedRequest(accountId: string, key: string) {
	const [event] = await readStream<{ data: { request: string; response: object } }>(idempotencyStream(accountId, key));

	return event?.data;
}

// One atomic append across every touched stream, each guarded by its expected revision.
// Returns false when another writer got there first (an account stream moved, or the key was taken).
export async function appendEvents(appends: AccountAppend[], processed?: ProcessedRequest) {
	const writes: AppendStreamRequest[] = appends.map(({ accountId, revision, event }) => ({
		streamName: accountStream(accountId),
		expectedState: revision,
		events: [jsonEvent(event)],
	}));

	if (processed) {
		const { accountId, key, request, response } = processed;

		writes.push({
			streamName: idempotencyStream(accountId, key),
			expectedState: NO_STREAM,
			events: [jsonEvent({ type: EventType.RequestProcessed, data: { request, response } })],
		});
	}

	try {
		await store.multiStreamAppend(writes);
	} catch (error) {
		if (error instanceof WrongExpectedVersionError) {
			return false;
		}
		throw error;
	}

	return true;
}
