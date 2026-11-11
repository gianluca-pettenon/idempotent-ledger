import type { AccountEvent } from '@api/features/ledger/ledger.events';
import {
  type AppendStreamRequest,
  BACKWARDS,
  END,
  jsonEvent,
  KurrentDBClient,
  NO_STREAM,
} from '@kurrent/kurrentdb-client';

export const store = KurrentDBClient.connectionString(
  Bun.env.KURRENTDB_URL as string,
);

export const ACCOUNT_STREAM = 'Account-';

const accountStream = (accountId: string) => `${ACCOUNT_STREAM}${accountId}`;
const idempotencyStream = (key: string) => `Idempotency-${key}`;

export type Account = {
  accountId: string;
  balance: number;
  revision: bigint | typeof NO_STREAM;
};

export type Append = { account: Account; event: AccountEvent };
export type Response = { balance: number };

type Saved<T> = T & { revision: bigint };

async function readLast<T>(streamName: string): Promise<Saved<T> | undefined> {
  const read = store.readStream(streamName, {
    direction: BACKWARDS,
    fromRevision: END,
    maxCount: 1,
  });

  try {
    const { value } = await read.next();
    const event = value?.event;

    if (!event) {
      return;
    }

    return { ...(event as T), revision: event.revision };
  } catch (error) {
    throw error;
  }
}

export async function loadAccount(accountId: string): Promise<Account> {
  const last = await readLast<AccountEvent>(accountStream(accountId));

  return {
    accountId,
    balance: last?.data.balance ?? 0,
    revision: last?.revision ?? NO_STREAM,
  };
}

export async function findResponse(key: string) {
  const last = await readLast<{ data: Response }>(idempotencyStream(key));

  return last?.data;
}

function accountRequest({ account, event }: Append): AppendStreamRequest {
  return {
    streamName: accountStream(account.accountId),
    expectedState: account.revision,
    events: [
      jsonEvent(event)
    ],
  };
}

function idempotencyRequest(
  key: string,
  response: Response,
): AppendStreamRequest {
  return {
    streamName: idempotencyStream(key),
    expectedState: NO_STREAM,
    events: [
      jsonEvent({ type: 'RequestProcessed', data: response })
    ],
  };
}

export async function append(
  appends: Append[],
  key: string | null,
  response: Response,
) {
  const requests = appends.map(accountRequest);

  if (key) {
    requests.push(idempotencyRequest(key, response));
  }

  try {
    await store.multiStreamAppend(requests);
  } catch (error) {
    throw error;
  }

  return true;
}
