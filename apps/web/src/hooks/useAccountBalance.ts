import { useEffect, useState } from 'react';

import { fetchAccount } from '@/lib/api';
import type { Transaction } from '@/lib/types';

type AccountState = {
  balance: number | null;
  transactions: Transaction[];
};

async function fetchAccountData(userId: string) {
  if (!userId) {
    return { balance: null, transactions: [] } satisfies AccountState;
  }

  const { account } = await fetchAccount(userId);

  return {
    balance: account.balance,
    transactions: account.transactions,
  };
}

export function useAccountBalance(userId: string) {
  const [account, setAccount] = useState<AccountState>({
    balance: null,
    transactions: [],
  });

  async function refresh() {
    setAccount(await fetchAccountData(userId));
  }

  useEffect(() => {
    void fetchAccountData(userId).then(setAccount);
  }, [userId]);

  return { ...account, refresh };
}
