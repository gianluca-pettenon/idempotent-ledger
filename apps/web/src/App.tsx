import { CONCURRENCY_DEMO, OperationKind } from '@idempotent-ledger/shared';
import { useState } from 'react';

import { AccountSelector } from '@/components/AccountSelector';
import { BalanceCard } from '@/components/BalanceCard';
import { OperationForm } from '@/components/OperationForm';
import { useAccountBalance } from '@/hooks/useAccountBalance';
import { useUsers } from '@/hooks/useUsers';
import { runConcurrentRequests } from '@/lib/api';
import type { Operation, RunEntry } from '@/lib/types';

export function App() {
  const { users, userId, setUserId } = useUsers();
  const {
    balance,
    transactions,
    refresh: refreshBalance,
  } = useAccountBalance(userId);

  const [operation, setOperation] = useState<Operation>(OperationKind.Deposit);
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState(String(CONCURRENCY_DEMO.DEFAULT_AMOUNT));
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<RunEntry[]>([]);

  const recipients = users.filter(user => user.id !== userId);
  const parsedAmount = Number(amount) || CONCURRENCY_DEMO.DEFAULT_AMOUNT;

  async function handleRun(withIdempotencyKey: boolean) {
    if (!userId || running) {
      return;
    }

    setRunning(true);
    setEntries([]);

    try {
      const results = await runConcurrentRequests({
        operation,
        userId,
        toUserId,
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
            ></OperationForm>

            <BalanceCard balance={balance} transactions={transactions} />
          </div>
        </section>
      </main>
    </>
  );
}
