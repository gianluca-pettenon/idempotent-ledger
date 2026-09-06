import { useEffect, useState } from 'react';

import { fetchAccount } from '@/app/lib/api';
import type { Transaction } from '@/app/types';

async function fetchAccountData(userId: string) {
  if (!userId) {
    return { balance: null, transactions: [] as Transaction[] };
  }

  const { account } = await fetchAccount(userId);

  return {
    balance: account.balance,
    transactions: account.transactions,
  };
}

export function useAccountBalance(userId: string) {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  async function refresh() {
    const { balance, transactions } = await fetchAccountData(userId);

    setBalance(balance);
    setTransactions(transactions);
  }

  useEffect(
    () => {
      void fetchAccountData(userId).then((account) => {
        setBalance(account.balance);
        setTransactions(account.transactions);
      });
    }, [userId]
  );

  return { balance, transactions, refresh };
}
