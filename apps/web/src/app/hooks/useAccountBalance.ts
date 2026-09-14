import { useEffect, useState } from 'react';

import { fetchAccount } from '@/app/lib/api';
import type { Transaction } from '@/app/lib/types';

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
  const [account, setAccount] = useState<AccountState>({ balance: null, transactions: [] });

  async function refresh() {
    setAccount(await fetchAccountData(userId));
  }

  useEffect(
    () => {
      void refresh();
    },
    [userId],
  );

  return { ...account, refresh };
}
