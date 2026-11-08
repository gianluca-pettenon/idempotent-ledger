import { ledgerRoutes } from '@api/features/ledger/ledger.routes';
import { projectionRoutes } from '@api/features/projection/projection.routes';
import { openapi } from '@elysia/openapi';
import { cors } from '@elysiajs/cors';
import { Elysia, StatusMap } from 'elysia';

export const app = new Elysia({ prefix: '/api' })
  .use(
    cors({
      origin: Bun.env.WEB_ORIGIN,
      allowedHeaders: ['Content-Type', 'Idempotency-Key'],
    }),
  )
  .use(openapi({ path: '/docs' }))
  .use(ledgerRoutes)
  .use(projectionRoutes)
  .onError(({ code, error, set }) => {
    if (code !== 'UNKNOWN') {
      return;
    }

    set.status =
      typeof error.cause === 'number'
        ? error.cause
        : StatusMap['Internal Server Error'];

    return { message: error.message };
  });

if (import.meta.main) {
  app.listen(Number(Bun.env.API_PORT), ({ hostname, port }) => {
    console.log(`API ready at ${hostname}:${port}`);
  });
}
