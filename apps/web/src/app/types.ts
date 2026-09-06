import type { OperationKind as Operation } from '@banking-ledger/shared';

export type { Operation };

export type User = {
  id: string;
  name: string;
};

export type Transaction = {
  id: string;
  type: 'deposit' | 'withdraw' | 'transfer_in' | 'transfer_out';
  amount: number;
  createdAt: string;
  counterpartyUserId?: string;
  counterpartyName?: string;
};

export type Account = {
  balance: number;
  transactions: Transaction[];
};

export type RunEntry = {
  label: string;
  outcome: string;
  ms: number;
};
