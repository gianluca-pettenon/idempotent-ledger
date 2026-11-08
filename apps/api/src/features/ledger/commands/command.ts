import {
  type Account,
  type Append,
  append,
  findResponse,
} from '@api/features/ledger/ledger.store';

enum Outcome {
  Processed = 'processed',
  Duplicate = 'duplicate',
}

const MAX_ATTEMPTS = 10;

type Decision = { appends: Append[]; balance: number };

export async function execute(
  key: string | null,
  decide: () => Promise<Decision>,
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const previous = key && (await findResponse(key));

    if (previous) {
      return { ...previous, outcome: Outcome.Duplicate };
    }

    const { appends, balance } = await decide();

    if (await append(appends, key, { balance })) {
      return { balance, outcome: Outcome.Processed };
    }
  }

  throw new Error('Account is under heavy contention, retry later', {
    cause: 409,
  });
}

export function assertFunds(account: Account, amount: number) {
  if (account.balance < amount) {
    throw new Error('Insufficient balance', { cause: 422 });
  }
}
