import {
  type AccountEvent,
  EventType,
} from '@api/features/ledger/ledger.events';
import { transactions } from '@api/features/projection/projection.store';
import type { Projector } from '@api/features/projection/projections';
import type { RecordedEvent } from '@kurrent/kurrentdb-client';

const TRANSACTION_TYPE: Record<AccountEvent['type'], string> = {
  [EventType.AccountCreated]: 'opened',
  [EventType.MoneyDeposited]: 'deposit',
  [EventType.MoneyWithdrawn]: 'withdraw',
  [EventType.TransferSent]: 'transfer_out',
  [EventType.TransferReceived]: 'transfer_in',
};

function amount(event: AccountEvent) {
  if (event.type === EventType.AccountCreated) {
    return event.data.balance;
  }

  return event.data.amount;
}

const withCounterparty: Partial<Record<AccountEvent['type'], true>> = {
  [EventType.TransferSent]: true,
  [EventType.TransferReceived]: true,
};

function counterpartyAccountId(event: AccountEvent) {
  if (!withCounterparty[event.type]) {
    return;
  }

  const transfer = event as Extract<AccountEvent, { type: EventType.TransferSent | EventType.TransferReceived }>;

  return transfer.data.counterpartyAccountId;
}

function statement(event: AccountEvent, recorded: RecordedEvent) {
  return {
    accountId: event.data.accountId,
    type: TRANSACTION_TYPE[event.type],
    amount: amount(event),
    counterpartyAccountId: counterpartyAccountId(event),
    version: Number(recorded.revision),
    createdAt: recorded.created,
  };
}

export const statementsProjector: Projector = {
  name: 'statements',
  setup: () => transactions.createIndexes([{ key: { accountId: 1, version: -1 } }]),
  project: (event, recorded) =>
    transactions.updateOne(
      { _id: recorded.id },
      { $setOnInsert: statement(event, recorded) },
      { upsert: true },
    ),
};
