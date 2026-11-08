import { EventType } from '@api/features/ledger/ledger.events';
import { append, store } from '@api/features/ledger/ledger.store';
import { NO_STREAM } from '@kurrent/kurrentdb-client';

const accounts = [
  {
    accountId: '01936b6e-8c1a-7000-8000-00000000000a',
    ownerName: 'User A',
    balance: 0,
  },
  {
    accountId: '01936b6e-8c1a-7000-8000-00000000000b',
    ownerName: 'User B',
    balance: 0,
  },
  {
    accountId: '01936b6e-8c1a-7000-8000-00000000000c',
    ownerName: 'User C',
    balance: 0,
  },
];

await Promise.try(() =>
  Promise.all(
    accounts.map(async data => {
      const created = await append(
        [
          {
            event: { type: EventType.AccountCreated, data },
            account: {
              accountId: data.accountId,
              balance: data.balance,
              revision: NO_STREAM,
            },
          },
        ],
        null,
        { balance: data.balance },
      );

      console.log(`${data.ownerName}: ${created ? 'created' : 'exists'}`);
    }),
  ),
).finally(() => store.dispose());
