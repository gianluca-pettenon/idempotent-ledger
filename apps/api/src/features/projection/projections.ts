import type { AccountEvent } from '@api/features/ledger/ledger.events';
import { ACCOUNT_STREAM, store } from '@api/features/ledger/ledger.store';
import { accountsProjector } from '@api/features/projection/projectors/accounts.projector';
import { statementsProjector } from '@api/features/projection/projectors/statements.projector';
import {
  PersistentSubscriptionExistsError,
  persistentSubscriptionToAllSettingsFromDefaults,
  RETRY,
  type RecordedEvent,
  START,
  streamNameFilter,
} from '@kurrent/kurrentdb-client';

export type Projector = {
  name: string;
  setup?: () => Promise<unknown>;
  project: (event: AccountEvent, recorded: RecordedEvent) => Promise<unknown>;
};

const PROJECTORS = [accountsProjector, statementsProjector];

function createGroup(name: string) {
  return Promise.try(() =>
    store.createPersistentSubscriptionToAll(
      name,
      persistentSubscriptionToAllSettingsFromDefaults({ startFrom: START }),
      {
        filter: streamNameFilter({ prefixes: [ACCOUNT_STREAM] }),
      },
    ),
  ).catch(error => {
    if (error instanceof PersistentSubscriptionExistsError) {
      return;
    }

    throw error;
  });
}

async function consume({ name, project }: Projector) {
  const subscription = store.subscribeToPersistentSubscriptionToAll(name);

  for await (const resolved of subscription) {
    await Promise.try(() =>
      project(
        resolved.event as unknown as AccountEvent,
        resolved.event as RecordedEvent,
      ),
    )
      .then(() => subscription.ack(resolved))
      .catch(error => subscription.nack(RETRY, String(error), resolved));
  }
}

async function subscribe(projector: Projector) {
  await Promise.all([projector.setup?.(), createGroup(projector.name)]);
  await consume(projector);
}

await Promise.all(PROJECTORS.map(subscribe));
