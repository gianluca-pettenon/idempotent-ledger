import { assertFunds, execute } from '@api/features/ledger/commands/command';
import { EventType } from '@api/features/ledger/ledger.events';
import { loadAccount } from '@api/features/ledger/ledger.store';

export const transfer = (
  fromAccountId: string,
  toAccountId: string,
  amount: number,
  key: string | null,
) =>
  execute(key, async () => {
    const [from, to] = await Promise.all([
      loadAccount(fromAccountId),
      loadAccount(toAccountId),
    ]);

    assertFunds(from, amount);

    const transferId = Bun.randomUUIDv7();
    const sent = {
      accountId: fromAccountId,
      counterpartyAccountId: toAccountId,
      transferId,
      amount,
      balance: from.balance - amount,
    };
    const received = {
      accountId: toAccountId,
      counterpartyAccountId: fromAccountId,
      transferId,
      amount,
      balance: to.balance + amount,
    };

    return {
      balance: sent.balance,
      appends: [
        { account: from, event: { type: EventType.TransferSent, data: sent } },
        {
          account: to,
          event: { type: EventType.TransferReceived, data: received },
        },
      ],
    };
  });
