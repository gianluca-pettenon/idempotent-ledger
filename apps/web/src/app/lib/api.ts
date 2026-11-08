import { CONCURRENCY_DEMO, OperationKind } from '@banking-ledger/shared';

import type { Account, Operation, RunEntry, User } from '@/app/lib/types';

type RequestOptions = RequestInit & {
  headers?: HeadersInit;
};

type ApiResponse<T> = {
  data: T;
};

type RunRequestParams = {
  operation: Operation;
  userId: string;
  toUserId: string;
  amount: number;
  withIdempotencyKey: boolean;
};

type MovementRequestParams = Omit<RunRequestParams, 'withIdempotencyKey'>;

const REQUEST_BUILDER: Record<
  Operation,
  (params: MovementRequestParams) => { path: string; body: unknown }
> = {
  [OperationKind.Deposit]: params => ({
    path: `/accounts/${params.userId}/deposits`,
    body: { amount: params.amount },
  }),
  [OperationKind.Withdraw]: params => ({
    path: `/accounts/${params.userId}/withdrawals`,
    body: { amount: params.amount },
  }),
  [OperationKind.Transfer]: params => ({
    path: '/transfers',
    body: {
      fromAccountId: params.userId,
      toAccountId: params.toUserId,
      amount: params.amount,
    },
  }),
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
    const body: { message?: string } | null = await response
      .json()
      .catch(() => null);

    throw new Error(
      `${response.status} ${body?.message ?? response.statusText}`,
    );
  }

  return response.json() as Promise<T>;
}

async function runRequest(
  params: MovementRequestParams,
  requestIndex: number,
  idempotencyKey: string | null,
): Promise<RunEntry> {
  const startedAt = performance.now();
  const label = `Request ${requestIndex + 1}`;
  const { path, body } = REQUEST_BUILDER[params.operation](params);
  let outcome = 'failed';
  let detail: string | undefined;

  try {
    const response = await request<ApiResponse<{ outcome: string }>>(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    outcome = response.data.outcome;
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
  const { data } = await request<ApiResponse<User[]>>('/accounts');

  return { users: data };
}

export async function fetchAccount(userId: string) {
  const { data } = await request<ApiResponse<Account>>(`/accounts/${userId}`);

  return { account: data };
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
