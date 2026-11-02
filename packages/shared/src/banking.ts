export const OperationKind = {
  Deposit: 'deposit',
  Withdraw: 'withdraw',
  Transfer: 'transfer',
} as const;

export type OperationKind = (typeof OperationKind)[keyof typeof OperationKind];

export const OPERATION_KINDS: readonly OperationKind[] = [
  OperationKind.Deposit,
  OperationKind.Withdraw,
  OperationKind.Transfer,
];

export const CONCURRENCY_DEMO = {
  REQUEST_COUNT: 4,
  DEFAULT_AMOUNT: 10,
} as const;
