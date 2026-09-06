import { ACCOUNT } from '@banking-ledger/terms';
import { formatUsd } from '@/shared/lib/format';

type BalanceCardProps = {
  balance: number | null;
};

export function BalanceCard({ balance }: BalanceCardProps) {
  return (
    <aside className="panel h-fit px-6 py-5 lg:sticky lg:top-[calc(var(--height-topbar)+1.5rem)]">
      <p className="eyebrow">{ACCOUNT.BALANCE_LABEL}</p>
      <p className="mt-4 font-mono text-4xl font-semibold tracking-[-0.05em] tabular-nums sm:text-5xl">
        {balance === null ? '—' : formatUsd(balance)}
      </p>
    </aside>
  );
}
