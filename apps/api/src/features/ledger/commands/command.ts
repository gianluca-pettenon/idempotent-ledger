import {
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
type Result = { balance: number; outcome: Outcome };

async function replay(key: string | null): Promise<Result | undefined> {
  if (!key) {
    return;
  }

  const previous = await findResponse(key);

  if (previous) {
    return { ...previous, outcome: Outcome.Duplicate };
  }
}

async function commit(
  key: string | null,
  decide: () => Promise<Decision>,
): Promise<Result | undefined> {
  const { appends, balance } = await decide();

  if (await append(appends, key, { balance })) {
    return { balance, outcome: Outcome.Processed };
  }
}

export async function execute(
  key: string | null,
  decide: () => Promise<Decision>,
) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const duplicate = await replay(key);

    if (duplicate) {
      return duplicate;
    }

    const processed = await commit(key, decide);

    if (processed) {
      return processed;
    }
  }

  throw new Error('Account is under heavy contention, retry later', {
    cause: 409,
  });
}
