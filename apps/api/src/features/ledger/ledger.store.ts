import {
	type AppendStreamRequest,
	BACKWARDS,
	END,
	jsonEvent,
	KurrentDBClient,
	NO_STREAM,
	type ReadStreamOptions,
	START,
	StreamNotFoundError,
	WrongExpectedVersionError,
} from "@kurrent/kurrentdb-client";
import { type AccountEvent, delta } from "@api/features/ledger/ledger.events";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

export const ACCOUNT_STREAM = "Account-";
const SNAPSHOT_EVERY = 100n;

const accountStream = (accountId: string) => `${ACCOUNT_STREAM}${accountId}`;
const snapshotStream = (accountId: string) => `Snapshot-${accountId}`;
const idempotencyStream = (key: string) => `Idempotency-${key}`;

export type Account = { accountId: string; balance: number; revision: bigint | typeof NO_STREAM };
export type Append = { account: Account; event: AccountEvent };
export type Response = { balance: number };

type Snapshot = { balance: number; revision: string };

async function read<T>(streamName: string, options?: ReadStreamOptions) {
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

// The source of truth: the latest snapshot plus the events appended after it.
export async function loadAccount(accountId: string): Promise<Account> {
	const [snapshot] = await read<{ data: Snapshot }>(snapshotStream(accountId), { direction: BACKWARDS, fromRevision: END, maxCount: 1 });
	const from = snapshot ? BigInt(snapshot.data.revision) : undefined;
	const events = await read<AccountEvent>(accountStream(accountId), { fromRevision: from === undefined ? START : from + 1n });

	return {
		accountId,
		balance: events.reduce((balance, event) => balance + delta(event), snapshot?.data.balance ?? 0),
		revision: events.at(-1)?.revision ?? from ?? NO_STREAM,
	};
}

export async function findResponse(key: string) {
	const [processed] = await read<{ data: Response }>(idempotencyStream(key));

	return processed?.data;
}

// One atomic append across every touched stream, each guarded by its expected revision.
// Returns false when another writer got there first: an account moved, or the key was taken.
export async function append(appends: Append[], key: string | null, response: Response) {
	const requests: AppendStreamRequest[] = appends.map(({ account, event }) => ({
		streamName: accountStream(account.accountId),
		expectedState: account.revision,
		events: [jsonEvent(event)],
	}));

	if (key) {
		requests.push({ streamName: idempotencyStream(key), expectedState: NO_STREAM, events: [jsonEvent({ type: "RequestProcessed", data: response })] });
	}

	try {
		await store.multiStreamAppend(requests);
	} catch (error) {
		if (error instanceof WrongExpectedVersionError) {
			return false;
		}
		throw error;
	}

	await Promise.all(appends.map(snapshot));

	return true;
}

// Every SNAPSHOT_EVERY events the balance is saved, so loading an account never replays its whole history.
async function snapshot({ account, event }: Append) {
	const revision = account.revision === NO_STREAM ? 0n : account.revision + 1n;

	if (revision > 0n && revision % SNAPSHOT_EVERY === 0n) {
		const data: Snapshot = { balance: account.balance + delta(event), revision: String(revision) };

		await store.appendToStream(snapshotStream(account.accountId), jsonEvent({ type: "AccountSnapshot", data }));
	}
}
