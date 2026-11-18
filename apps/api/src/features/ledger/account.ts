import type { Account } from '@api/features/ledger/ledger.store';

export function assertFunds(account: Account, amount: number) {
  if (account.balance < amount) {
    throw new Error(`Insufficient funds: ${amount} > ${account.balance}`, {
      cause: 422,
    });
  }
}
