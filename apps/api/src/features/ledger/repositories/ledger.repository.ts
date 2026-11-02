import {
	type AppendStreamRequest,
	BACKWARDS,
	END,
	jsonEvent,
	KurrentDBClient,
	NO_STREAM,
	type ReadStreamOptions,
	StreamNotFoundError,
	WrongExpectedVersionError,
} from "@kurrent/kurrentdb-client";
import { type Account, type AccountEvent, balanceOf } from "@api/features/ledger/domain/ledger.domain";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

type Revision = bigint | typeof NO_STREAM;

export type AccountAppend = { accountId: string; revision: Revision; event: AccountEvent };

export type ProcessedRequest = { accountId: string; key: string; request: string; response: object };

// The account's state at a revision, so loading replays only the events after it.
type Snapshot = { balance: number; revision: string };

export const ACCOUNT_STREAM_PREFIX = "account-";
export const SNAPSHOT_EVERY = 100;
const REQUEST_PROCESSED = "RequestProcessed";
const ACCOUNT_SNAPSHOT = "AccountSnapshot";

const accountStream = (accountId: string) => `${ACCOUNT_STREAM_PREFIX}${accountId}`;
// Outside the account- prefix, so the projector never sees snapshots.
const snapshotStream = (accountId: string) => `snapshot-${accountStream(accountId)}`;
const idempotencyStream = (accountId: string, key: string) => `idempotency-${accountId}-${key}`;

async function readStream<T>(streamName: string, options?: ReadStreamOptions) {
	const events: (T & { revision: bigint })[] = [];

	try {
		for await (const { event } of store.readStream(streamName, options)) {
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

export async function findSnapshot(accountId: string) {
	const [event] = await readStream<{ data: Snapshot }>(snapshotStream(accountId), {
		direction: BACKWARDS,
		fromRevision: END,
		maxCount: 1,
	});

	return event && { balance: event.data.balance, revision: BigInt(event.data.revision) };
}

async function saveSnapshot(accountId: string, snapshot: { balance: number; revision: bigint }) {
	const streamName = snapshotStream(accountId);

	await store.appendToStream(
		streamName,
		jsonEvent({ type: ACCOUNT_SNAPSHOT, data: { balance: snapshot.balance, revision: String(snapshot.revision) } }),
	);
	await store.setStreamMetadata(streamName, { maxCount: 1 });
}

// The account is rebuilt from the event store only: the latest snapshot plus the events after it.
// It exists once its stream holds AccountCreated; until then it is appended to as NO_STREAM.
export async function loadAccount(accountId: string): Promise<Account & { revision: Revision }> {
	const snapshot = await findSnapshot(accountId);
	const events = await readStream<AccountEvent>(
		accountStream(accountId),
		snapshot && { fromRevision: snapshot.revision + 1n },
	);
	const lastRevision = events.at(-1)?.revision ?? snapshot?.revision;
	const balance = (snapshot?.balance ?? 0) + balanceOf(events);

	// A snapshot is a cache of immutable history, so any reader may write one; it never needs a lock.
	if (lastRevision !== undefined && events.length >= SNAPSHOT_EVERY) {
		await saveSnapshot(accountId, { balance, revision: lastRevision });
	}

	return { accountId, opened: lastRevision !== undefined, revision: lastRevision ?? NO_STREAM, balance };
}

export async function findProcessedRequest(accountId: string, key: string) {
	const [event] = await readStream<{ data: { request: string; response: object } }>(idempotencyStream(accountId, key));

	return event?.data;
}

// One atomic append across every touched stream. Returns false when another writer got there first.
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
			events: [jsonEvent({ type: REQUEST_PROCESSED, data: { request, response } })],
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
