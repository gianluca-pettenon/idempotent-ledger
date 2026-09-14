import { ACCOUNT, CONCURRENCY } from '@banking-ledger/terms';

import type { User } from '@/app/lib/types';
import { Select } from '@/shared/ui';

type AccountSelectorProps = {
  users: User[];
  userId: string;
  onChange: (id: string) => void;
};

export function AccountSelector({
  users,
  userId,
  onChange,
}: AccountSelectorProps) {
  const options = users.map(({ id, name }) => ({ value: id, label: name }));

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="container flex min-h-[var(--height-topbar)] flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="eyebrow">{CONCURRENCY.HEADER.TITLE}</p>
          <p className="text-sm text-muted-foreground">
            {CONCURRENCY.HEADER.DESCRIPTION}
          </p>
        </div>

        <div className="w-full max-w-sm lg:w-[22rem]">
          <div className="flex flex-col gap-2 text-sm">
            <span className="eyebrow">{ACCOUNT.LABEL}</span>
            <Select value={userId} onChange={onChange} options={options} />
          </div>
        </div>
      </div>
    </header>
  );
}
