import { CONCURRENCY_DEMO, OperationKind } from '@banking-ledger/shared';
import { CONCURRENCY } from '@banking-ledger/terms';
import { useState } from 'react';

import { AccountSelector } from '@/app/components/AccountSelector';
import { BalanceCard } from '@/app/components/BalanceCard';
import { OperationForm } from '@/app/components/OperationForm';
import { useAccountBalance } from '@/app/hooks/useAccountBalance';
import { useUsers } from '@/app/hooks/useUsers';
import { runConcurrentRequests } from '@/app/lib/api';
import type { Operation, RunEntry } from '@/app/types';

export function App() {
  const { users, userId, setUserId } = useUsers();
  const { balance, refresh: refreshBalance } = useAccountBalance(userId);

  const [operation, setOperation] = useState<Operation>(OperationKind.Deposit);
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState(String(CONCURRENCY_DEMO.DEFAULT_AMOUNT));
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<RunEntry[]>([]);

  const recipients = users.filter((user) => user.id !== userId);
  const selectedRecipientId = toUserId || recipients[0]?.id || '';
  const parsedAmount = Number(amount) || CONCURRENCY_DEMO.DEFAULT_AMOUNT;

  async function handleRun(withIdempotencyKey: boolean) {
    if (!userId || running) return;

    setRunning(true);
    setEntries([]);

    try {
      const results = await runConcurrentRequests({
        operation,
        userId,
        toUserId: selectedRecipientId,
        amount: parsedAmount,
        withIdempotencyKey,
      });

      setEntries(results);
      refreshBalance();
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <AccountSelector users={users} userId={userId} onChange={setUserId} />

      <main className="container py-6 sm:py-8 lg:py-10">
        <section className="space-y-4">
          <div className="panel relative overflow-hidden px-5 py-5 sm:px-6 sm:py-6">
            <div className="absolute top-0 right-0 h-32 w-32 rounded-full bg-primary/12 blur-3xl" />
            <div className="absolute top-8 right-20 h-24 w-24 rounded-full bg-info/12 blur-3xl" />

            <div className="relative space-y-1">
              <p className="eyebrow">{CONCURRENCY.DRAWER.TITLE}</p>
              <p className="section-copy">{CONCURRENCY.DRAWER.DESCRIPTION}</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <OperationForm
              operation={operation}
              running={running}
              amount={amount}
              toUserId={toUserId}
              recipients={recipients}
              entries={entries}
              onOperationChange={setOperation}
              onAmountChange={setAmount}
              onToUserIdChange={setToUserId}
              onRun={handleRun}
            />

            <BalanceCard balance={balance} />
          </div>
        </section>
      </main>
    </>
  );
}
