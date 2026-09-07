import { CONCURRENCY_DEMO, OperationKind } from '@banking-ledger/shared';

import type { Account, Operation, RunEntry, User } from '@/app/types';

type RequestOptions = RequestInit & {
  headers?: HeadersInit;
};

type AccountResponse = {
  account?: Account;
  balance?: number;
  transactions?: Account['transactions'];
  userId?: string;
};

type MetaResponse = {
  outcome?: string;
};

type TransactionResponse = {
  meta?: MetaResponse;
};

type RunRequestParams = {
  operation: Operation;
  userId: string;
  toUserId: string;
  amount: number;
  withIdempotencyKey: boolean;
};

function getApiBaseUrl() {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (!baseUrl) {
    return '/api';
  }

  return baseUrl.replace(/\/$/, '');
}

const API_BASE_URL = getApiBaseUrl();

async function request<T>(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizeAccount(response: AccountResponse): Account {
  if (response.account) {
    return response.account;
  }

  return {
    balance: response.balance ?? 0,
    transactions: response.transactions ?? [],
  };
}

function createRequestId() {
  return crypto.randomUUID();
}

function createIdempotencyKey(withIdempotencyKey: boolean) {
  if (!withIdempotencyKey) {
    return null;
  }

  return crypto.randomUUID();
}

function getRequestPath({ operation, userId }: Pick<RunRequestParams, 'operation' | 'userId'>) {
  if (operation === OperationKind.Transfer) {
    return '/transfers';
  }

  return `/accounts/${userId}/transactions`;
}

function getRequestBody({ operation, userId, toUserId, amount }: Omit<RunRequestParams, 'withIdempotencyKey'>) {
  if (operation === OperationKind.Transfer) {
    return {
      fromUserId: userId,
      toUserId,
      amount,
    };
  }

  return {
    type: operation,
    amount,
  };
}

async function runRequest(
  params: Omit<RunRequestParams, 'withIdempotencyKey'>,
  requestIndex: number,
  idempotencyKey: string | null,
): Promise<RunEntry> {
  const startedAt = performance.now();

  try {
    const response = await request<TransactionResponse>(getRequestPath(params), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': createRequestId(),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(getRequestBody(params)),
    });

    const duration = Math.round(performance.now() - startedAt);

    return {
      label: `Request ${requestIndex + 1}`,
      outcome: response.meta?.outcome ?? 'processed',
      ms: duration,
    };
  } catch {
    const duration = Math.round(performance.now() - startedAt);

    return {
      label: `Request ${requestIndex + 1}`,
      outcome: 'failed',
      ms: duration,
    };
  }
}

export async function fetchUsers() {
  return request<{ users: User[] }>('/users');
}

export async function fetchAccount(userId: string) {
  const response = await request<AccountResponse>(`/accounts/${userId}`);

  return {
    account: normalizeAccount(response),
  };
}

export async function runConcurrentRequests(params: RunRequestParams) {
  const idempotencyKey = createIdempotencyKey(params.withIdempotencyKey);
  const requestParams = {
    operation: params.operation,
    userId: params.userId,
    toUserId: params.toUserId,
    amount: params.amount,
  };

  return Promise.all(
    Array.from({ length: CONCURRENCY_DEMO.REQUEST_COUNT }, (_, requestIndex) =>
      runRequest(requestParams, requestIndex, idempotencyKey),
    ),
  );
}
