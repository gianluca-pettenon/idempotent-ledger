import { describe, expect, test } from 'bun:test';
import { CONCURRENCY_DEMO, OperationKind, OPERATION_KINDS, TransactionKind } from '@shared/banking.ts';

describe('OperationKind', () => {
  test('defines deposit, withdraw, and transfer literals', () => {
    expect(OperationKind.Deposit).toBe('deposit');
    expect(OperationKind.Withdraw).toBe('withdraw');
    expect(OperationKind.Transfer).toBe('transfer');
  });

  test('lists every supported operation', () => {
    expect(OPERATION_KINDS).toEqual(['deposit', 'withdraw', 'transfer']);
  });
});

describe('TransactionKind', () => {
  test('defines deposit and withdraw API literals', () => {
    expect(TransactionKind.Deposit).toBe('deposit');
    expect(TransactionKind.Withdraw).toBe('withdraw');
  });

  test('reuses the transaction subset of OperationKind', () => {
    expect(TransactionKind.Deposit).toBe(OperationKind.Deposit);
    expect(TransactionKind.Withdraw).toBe(OperationKind.Withdraw);
  });

  test('exposes only the supported kinds', () => {
    expect(Object.keys(TransactionKind)).toEqual(['Deposit', 'Withdraw']);
  });
});

describe('CONCURRENCY_DEMO', () => {
  test('uses numeric demo defaults', () => {
    expect(CONCURRENCY_DEMO.REQUEST_COUNT).toBe(4);
    expect(CONCURRENCY_DEMO.DEFAULT_AMOUNT).toBe(10);
    expect(typeof CONCURRENCY_DEMO.DEFAULT_AMOUNT).toBe('number');
  });
});
