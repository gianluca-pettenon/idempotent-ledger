import { assertFunds, execute } from '@api/features/ledger/commands/command';
import { EventType } from '@api/features/ledger/ledger.events';
import { type Account, loadAccount } from '@api/features/ledger/ledger.store';

function movements(from: Account, to: Account, amount: number) {
  const transferId = Bun.randomUUIDv7();

  const movement = (
    account: Account,
    counterparty: Account,
    balance: number,
  ) => ({
    accountId: account.accountId,
    counterpartyAccountId: counterparty.accountId,
    transferId,
    amount,
    balance,
  });

  return {
    sent: movement(from, to, from.balance - amount),
    received: movement(to, from, to.balance + amount),
  };
}

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

    const { sent, received } = movements(from, to, amount);

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
