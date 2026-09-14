import { describe, expect, test } from 'bun:test';
import * as shared from '@shared/index.ts';

describe('package exports', () => {
  test('re-exports banking and locale symbols', () => {
    expect(shared.OperationKind.Deposit).toBe('deposit');
    expect(shared.OPERATION_KINDS).toEqual(['deposit', 'withdraw', 'transfer']);
    expect(shared.TransactionKind.Deposit).toBe('deposit');
    expect(shared.CONCURRENCY_DEMO.REQUEST_COUNT).toBe(4);
    expect(shared.DISPLAY_LOCALE).toBe('en-US');
    expect(shared.CURRENCY).toBe('USD');
    expect(shared.AMOUNT_PLACEHOLDER).toBe('0.00');
  });
});
