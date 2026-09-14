import { CONCURRENCY_DEMO, OperationKind } from '@banking-ledger/shared';

import type { Account, Operation, RunEntry, User } from '@/app/types';

type RequestOptions = RequestInit & {
  headers?: HeadersInit;
};

type AccountResponse = {
  account: Account;
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
    const body: { message?: string } | null = await response.json().catch(() => null);
    throw new Error(`${response.status} ${body?.message ?? response.statusText}`);
  }

  return response.json() as Promise<T>;
}

async function runRequest(
  params: Omit<RunRequestParams, 'withIdempotencyKey'>,
  requestIndex: number,
  idempotencyKey: string | null,
): Promise<RunEntry> {
  const startedAt = performance.now();
  const label = `Request ${requestIndex + 1}`;
  const path =
    params.operation === OperationKind.Transfer
      ? '/transfers'
      : `/accounts/${params.userId}/transactions`;
  const body =
    params.operation === OperationKind.Transfer
      ? {
          fromUserId: params.userId,
          toUserId: params.toUserId,
          amount: params.amount,
        }
      : {
          type: params.operation,
          amount: params.amount,
        };
  let outcome = 'failed';
  let detail: string | undefined;

  try {
    const response = await request<TransactionResponse>(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': crypto.randomUUID(),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    outcome = response.meta?.outcome ?? 'processed';
  } catch (error) {
    detail = error instanceof Error ? error.message : undefined;
  }

  return {
    label,
    outcome,
    ms: Math.round(performance.now() - startedAt),
    detail,
  };
}

export async function fetchUsers() {
  return request<{ users: User[] }>('/users');
}

export async function fetchAccount(userId: string) {
  const { account } = await request<AccountResponse>(`/accounts/${userId}`);

  return { account };
}

export async function runConcurrentRequests(params: RunRequestParams) {
  const idempotencyKey = params.withIdempotencyKey ? crypto.randomUUID() : null;
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
