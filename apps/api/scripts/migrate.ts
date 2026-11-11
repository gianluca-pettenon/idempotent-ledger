import { EventType } from '@api/features/ledger/ledger.events';
import { append, store } from '@api/features/ledger/ledger.store';
import { NO_STREAM } from '@kurrent/kurrentdb-client';

const accounts = [
  {
    accountId: '01a1cb31-e58b-735a-8791-bbc1dccba6c0',
    ownerName: 'User A',
    balance: 0,
  },
  {
    accountId: '01a1cb32-2230-75de-8851-21eea78b0a57',
    ownerName: 'User B',
    balance: 0,
  },
  {
    accountId: '01a1cb32-64d6-7259-aff4-81d49c9dd032',
    ownerName: 'User C',
    balance: 0,
  },
  {
    accountId: '01a1cb33-249c-713a-98cc-86dff22b26d2',
    ownerName: 'User D',
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
