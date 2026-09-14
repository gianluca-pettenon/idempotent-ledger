import { ACCOUNT, STATEMENT } from '@banking-ledger/terms';

import type { Transaction } from '@/app/types';
import { formatDate, formatUsd } from '@/shared/lib/format';

type BalanceCardProps = {
  balance: number | null;
  transactions: Transaction[];
};

const OUTGOING_TYPES: ReadonlySet<Transaction['type']> = new Set([
  'withdraw',
  'transfer_out',
]);

const TRANSACTION_LABEL: Record<
  Transaction['type'],
  (counterpartyName?: string) => string
> = {
  deposit: () => STATEMENT.BADGE.DEPOSIT,
  withdraw: () => STATEMENT.BADGE.WITHDRAWAL,
  transfer_in: (counterpartyName) =>
    counterpartyName
      ? STATEMENT.transferFrom(counterpartyName)
      : STATEMENT.INCOMING_TRANSFER,
  transfer_out: (counterpartyName) =>
    counterpartyName
      ? STATEMENT.transferTo(counterpartyName)
      : STATEMENT.OUTGOING_TRANSFER,
};

function getTransactionViewModel(transaction: Transaction) {
  const formattedAmount = formatUsd(transaction.amount);
  const outgoing = OUTGOING_TYPES.has(transaction.type);

  return {
    label: TRANSACTION_LABEL[transaction.type](transaction.counterpartyName),
    amount: outgoing ? `-${formattedAmount}` : formattedAmount,
    amountClassName: outgoing ? 'text-danger' : 'text-info',
  };
}

export function BalanceCard({ balance, transactions }: BalanceCardProps) {
  return (
    <aside className="panel h-fit px-6 py-5 lg:sticky lg:top-[calc(var(--height-topbar)+1.5rem)]">
      <p className="eyebrow">{ACCOUNT.BALANCE_LABEL}</p>
      <p className="mt-4 font-mono text-4xl font-semibold tracking-[-0.05em] tabular-nums sm:text-5xl">
        {balance === null ? '—' : formatUsd(balance)}
      </p>

      <div className="mt-6 border-t border-border/80 pt-5">
        <p className="eyebrow">{STATEMENT.TITLE}</p>

        {!transactions.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {STATEMENT.EMPTY}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {transactions.map((transaction) => {
              const presentation = getTransactionViewModel(transaction);

              return (
                <li
                  key={transaction.id}
                  className="rounded-2xl border border-border/80 bg-surface-raised px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {presentation.label}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(transaction.createdAt)}
                      </p>
                    </div>

                    <p
                      className={[
                        'font-mono text-sm font-medium tabular-nums',
                        presentation.amountClassName,
                      ].join(' ')}
                    >
                      {presentation.amount}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
