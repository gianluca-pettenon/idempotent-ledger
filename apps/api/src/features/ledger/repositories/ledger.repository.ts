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
import { EventType, StreamPrefix } from "@api/features/ledger/domain/ledger.events";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

type Revision = bigint | typeof NO_STREAM;

export type AccountAppend = { accountId: string; revision: Revision; event: AccountEvent };

export type ProcessedRequest = { accountId: string; key: string; request: string; response: object };

// The account's state at a revision, so loading replays only the events after it.
type Snapshot = { balance: number; revision: string };

export const SNAPSHOT_EVERY = 100;

const accountStream = (accountId: string) => `${StreamPrefix.Account}${accountId}`;
const snapshotStream = (accountId: string) => `${StreamPrefix.Snapshot}${accountId}`;
const idempotencyStream = (accountId: string, key: string) => `${StreamPrefix.Idempotency}${accountId}-${key}`;

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
		jsonEvent({ type: EventType.AccountSnapshot, data: { balance: snapshot.balance, revision: String(snapshot.revision) } }),
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

export enum AppendResult {
	Appended = "appended",
	// Another writer changed an account stream first: re-read and decide again.
	AccountConflict = "account_conflict",
	// The idempotency stream already exists: either a concurrent request with the same key, or an expired key.
	KeyConflict = "key_conflict",
}

// Clients retry for minutes, not forever: after this the record expires and the key may not be reused.
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

// One atomic append across every touched stream.
export async function appendEvents(appends: AccountAppend[], processed?: ProcessedRequest) {
	const writes: AppendStreamRequest[] = appends.map(({ accountId, revision, event }) => ({
		streamName: accountStream(accountId),
		expectedState: revision,
		events: [jsonEvent(event)],
	}));

	const keyStream = processed && idempotencyStream(processed.accountId, processed.key);

	if (processed && keyStream) {
		const { request, response } = processed;

		writes.push({
			streamName: keyStream,
			expectedState: NO_STREAM,
			events: [jsonEvent({ type: EventType.RequestProcessed, data: { request, response } })],
		});
	}

	try {
		await store.multiStreamAppend(writes);
	} catch (error) {
		if (error instanceof WrongExpectedVersionError) {
			return error.streamName === keyStream ? AppendResult.KeyConflict : AppendResult.AccountConflict;
		}
		throw error;
	}

	if (keyStream) {
		// A second write: if it fails the money already moved, so the record only misses its expiry.
		await store.setStreamMetadata(keyStream, { maxAge: IDEMPOTENCY_TTL_SECONDS }).catch(console.error);
	}

	return AppendResult.Appended;
}
