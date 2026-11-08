import { ACCOUNT, STATEMENT } from '@banking-ledger/terms';

import type { Transaction } from '@/app/lib/types';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatUsd } from '@/shared/lib/format';

type BalanceCardProps = {
  balance: number | null;
  transactions: Transaction[];
};

const OUTGOING_TYPES: ReadonlySet<Transaction['type']> = new Set([
  'withdraw',
  'transfer_out',
  'reversal_out',
]);

const TRANSACTION_LABEL: Record<
  Transaction['type'],
  (counterpartyName?: string) => string
> = {
  opened: () => STATEMENT.BADGE.OPENED,
  deposit: () => STATEMENT.BADGE.DEPOSIT,
  withdraw: () => STATEMENT.BADGE.WITHDRAWAL,
  transfer_in: counterpartyName =>
    counterpartyName
      ? STATEMENT.transferFrom(counterpartyName)
      : STATEMENT.INCOMING_TRANSFER,
  transfer_out: counterpartyName =>
    counterpartyName
      ? STATEMENT.transferTo(counterpartyName)
      : STATEMENT.OUTGOING_TRANSFER,
  reversal_in: () => STATEMENT.BADGE.REVERSAL,
  reversal_out: () => STATEMENT.BADGE.REVERSAL,
};

function getTransactionViewModel(transaction: Transaction) {
  const formattedAmount = formatUsd(transaction.amount);
  const outgoing = OUTGOING_TYPES.has(transaction.type);
  const opened = transaction.type === 'opened';

  return {
    label: TRANSACTION_LABEL[transaction.type](transaction.counterpartyName),
    amount: outgoing ? `-${formattedAmount}` : formattedAmount,
    amountClassName: opened
      ? 'text-muted-foreground'
      : outgoing
        ? 'text-danger'
        : 'text-info',
    dotClassName: opened ? 'bg-primary' : outgoing ? 'bg-danger' : 'bg-info',
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
          <ol className="mt-5 max-h-96 overflow-y-auto">
            {transactions.map((transaction, index) => {
              const presentation = getTransactionViewModel(transaction);
              const last = index === transactions.length - 1;

              return (
                <li key={transaction.id} className="relative pl-5">
                  {last ? null : (
                    <span
                      aria-hidden
                      className="absolute top-3 -bottom-1.5 left-[0.3rem] w-px bg-border-strong"
                    />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1.5 left-0 size-2.5 rounded-full ring-4 ring-surface',
                      presentation.dotClassName,
                    )}
                  />
                  <div
                    className={cn(
                      'flex items-start justify-between gap-3',
                      last ? 'pb-0' : 'pb-5',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {presentation.label}
                      </p>
                      <time
                        dateTime={transaction.createdAt}
                        className="mt-1 block text-xs text-muted-foreground"
                      >
                        {formatDate(transaction.createdAt)}
                      </time>
                    </div>
                    <p
                      className={cn(
                        'font-mono text-sm font-medium tabular-nums',
                        presentation.amountClassName,
                      )}
                    >
                      {presentation.amount}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}
