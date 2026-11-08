import { loadAccount } from '@api/features/ledger/ledger.store';
import {
  accounts,
  transactions,
} from '@api/features/projection/projection.store';
import { Elysia } from 'elysia';

export const projectionRoutes = new Elysia()
  .get('/accounts', async () => {
    const documents = await accounts.find().sort({ ownerName: 1 }).toArray();

    return {
      data: documents.map(({ _id, ownerName }) => ({
        id: _id,
        name: ownerName,
      })),
    };
  })
  .get('/accounts/:accountId', async ({ params: { accountId } }) => {
    const account = await accounts.findOne({ _id: accountId });

    if (!account) {
      throw new Error(`Account ${accountId} not found`, { cause: 404 });
    }

    const [{ balance }, lines] = await Promise.all([
      loadAccount(accountId),
      transactions
        .aggregate([
          { $match: { accountId } },
          { $sort: { version: -1 } },
          {
            $lookup: {
              from: 'accounts',
              localField: 'counterpartyAccountId',
              foreignField: '_id',
              as: 'counterparty',
            },
          },
          {
            $project: {
              _id: 0,
              id: '$_id',
              type: 1,
              amount: 1,
              createdAt: 1,
              counterpartyAccountId: 1,
              counterpartyName: { $first: '$counterparty.ownerName' },
            },
          },
        ])
        .toArray(),
    ]);

    return { data: { balance, transactions: lines } };
  });
