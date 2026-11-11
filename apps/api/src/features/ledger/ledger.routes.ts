import { deposit } from '@api/features/ledger/commands/deposit';
import { transfer } from '@api/features/ledger/commands/transfer';
import { withdraw } from '@api/features/ledger/commands/withdraw';
import { Elysia, t } from 'elysia';

const getIdempotencyKey = (request: Request) => request.headers.get('Idempotency-Key');

export const ledgerRoutes = new Elysia()
  .post(
    '/accounts/:accountId/deposits',
    async ({ params, body, request }) => {
      return {
        data: await deposit(
          params.accountId,
          body.amount,
          getIdempotencyKey(request),
        ),
      };
    },
    { body: t.Object({ amount: t.Number({ exclusiveMinimum: 0 }) }) },
  )
  .post(
    '/accounts/:accountId/withdrawals',
    async ({ params, body, request }) => {
      return {
        data: await withdraw(
          params.accountId,
          body.amount,
          getIdempotencyKey(request),
        ),
      };
    },
    { body: t.Object({ amount: t.Number({ exclusiveMinimum: 0 }) }) },
  )
  .post(
    '/transfers',
    async ({ body, request }) => {
      return {
        data: await transfer(
          body.fromAccountId,
          body.toAccountId,
          body.amount,
          getIdempotencyKey(request),
        ),
      };
    },
    {
      body: t.Object({
        fromAccountId: t.String({ minLength: 1 }),
        toAccountId: t.String({ minLength: 1 }),
        amount: t.Number({ exclusiveMinimum: 0 }),
      }),
    },
  );
