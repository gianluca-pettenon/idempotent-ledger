import { describe, expect, test } from 'bun:test';
import { CONCURRENCY_DEMO, OperationKind, OPERATION_KINDS } from '@shared/banking.ts';

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

describe('CONCURRENCY_DEMO', () => {
  test('uses numeric demo defaults', () => {
    expect(CONCURRENCY_DEMO.REQUEST_COUNT).toBe(4);
    expect(CONCURRENCY_DEMO.DEFAULT_AMOUNT).toBe(10);
    expect(typeof CONCURRENCY_DEMO.DEFAULT_AMOUNT).toBe('number');
  });
});
