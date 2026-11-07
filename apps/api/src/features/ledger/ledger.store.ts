import {
	type AppendStreamRequest,
	BACKWARDS,
	END,
	jsonEvent,
	KurrentDBClient,
	NO_STREAM,
	StreamNotFoundError,
	WrongExpectedVersionError,
} from "@kurrent/kurrentdb-client";
import type { AccountEvent } from "@api/features/ledger/ledger.events";

export const store = KurrentDBClient.connectionString(Bun.env.KURRENTDB_URL as string);

export const ACCOUNT_STREAM = "Account-";

const accountStream = (accountId: string) => `${ACCOUNT_STREAM}${accountId}`;
const idempotencyStream = (key: string) => `Idempotency-${key}`;

export type Account = { accountId: string; balance: number; revision: bigint | typeof NO_STREAM };
export type Append = { account: Account; event: AccountEvent };
export type Response = { balance: number };

async function readLast<T>(streamName: string) {
	try {
		for await (const { event } of store.readStream(streamName, { direction: BACKWARDS, fromRevision: END, maxCount: 1 })) {
			return event && { ...(event as T), revision: event.revision };
		}
	} catch (error) {
		if (!(error instanceof StreamNotFoundError)) {
			throw error;
		}
	}
}

export async function loadAccount(accountId: string): Promise<Account> {
	const { data, revision } = await readLast<AccountEvent>(accountStream(accountId));

	return { accountId, balance: data.balance ?? 0, revision: revision ?? NO_STREAM };
}

export async function findResponse(key: string) {
	const last = await readLast<{ data: Response }>(idempotencyStream(key));

	return last?.data;
}

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

	return true;
}
