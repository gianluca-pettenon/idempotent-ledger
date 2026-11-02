## What this is

An event-sourced ledger with CQRS, split into processes that only meet through the event store:

- **KurrentDB** ([formerly EventStoreDB](https://www.kurrent.io/)) is the source of truth. Every fact, from opening an account to moving money, is an immutable event.
- **MongoDB** holds the read model: one document per account and one per statement line, projected from the events.
- **api** decides and appends. **projector** subscribes and writes MongoDB. **seed** opens the default accounts. Each scales and fails on its own: the API is stateless, so it can run many replicas, and optimistic concurrency keeps them consistent.

It is not a payment rail or a bank core. It shows idempotent commands, optimistic concurrency, atomic multi-account writes, and a rebuildable read model.

```text
            commands                         queries
POST ...  ──────────► api ──append──► KurrentDB        api ◄──find── MongoDB
                       (decide on the                              ▲
                        stream's fold)          projector ─────────┘
                                         (subscribeToAll + checkpoint)
```

## Model

One stream per account. The account exists once its stream holds `AccountCreated`. Every event carries the `accountId` it belongs to.

```text
account-{accountId}    AccountCreated   { accountId, ownerName }
                       MoneyDeposited   { accountId, amount }
                       MoneyWithdrawn   { accountId, amount }
                       TransferSent     { accountId, transferId, counterpartyAccountId, amount }
                       TransferReceived { accountId, transferId, counterpartyAccountId, amount }
idempotency-{accountId}-{key}
                       RequestProcessed { request, response }
```

```text
balance = Σ MoneyDeposited + Σ TransferReceived − Σ MoneyWithdrawn − Σ TransferSent
```

### Snapshots

Commands rebuild the account from the event store, never from MongoDB, so a lagging read model can never let a withdrawal or transfer through without funds. To keep that cheap, the account's state is snapshotted:

```text
snapshot-account-{accountId}   AccountSnapshot { balance, revision }   (stream keeps only the latest)

load = latest snapshot + events of account-{accountId} after its revision
```

Whenever a load replays `SNAPSHOT_EVERY` (100) events or more, it saves the state it just folded. A snapshot is a cache of immutable history: any reader may write one, it needs no lock, and deleting it only makes the next load slower. The `snapshot-` prefix keeps it out of the projector's `account-*` filter.

Corrections are new events, never edits. Commands always decide on the stream itself, never on MongoDB, so the invariants (no overdraft, no movement on an unknown account) hold even when the read model lags.

## Read model

The projector is a catch-up subscription on `$all` (filtered to `account-*`). It adds what the events do not carry:

```text
AccountCreated  { accountId, ownerName }   ->  accounts     { _id, ownerName, balance: 0, version: 0 }
MoneyDeposited  { accountId, amount }      ->  accounts     $inc balance, version = stream revision
                                               transactions { _id: eventId, type, amount, ... }
TransferSent    { ..., counterpartyAccountId } ->  transactions also get the counterparty's name
```

There are no multi-document transactions. Every write is idempotent instead: statement lines are upserted by event id, and the balance only moves when the event is newer than the account's `version`. The `$all` position is saved after each event, so a crash replays at most one event, harmlessly.

The read model is disposable: drop the `banking-ledger` database and the projector rebuilds it from the events. Reads are eventually consistent, typically a few milliseconds behind the writes.

## A command

```text
POST /transfers   Idempotency-Key: K
  |
  1. read idempotency-{from}-{K}
       exists, same request      -> replay saved result   (duplicate)
       exists, different request -> 409
  2. read both account streams, fold balances, remember each stream's revision
  3. decide: same account? insufficient funds?  -> 422
  4. one atomic multi-stream append:
       account-{from}             expected revision = r1   TransferSent
       account-{to}               expected revision = r2   TransferReceived
       idempotency-{from}-{K}     expected = no stream     RequestProcessed
  5. wrong expected revision -> someone wrote first, go back to 1
```

- **Optimistic concurrency** is the stream revision. No locks; a conflicting append fails and the command retries from a fresh read.
- **Atomic transfers**: both legs and the idempotency record commit together or not at all (`multiStreamAppend`, KurrentDB 25.1+).
- **Idempotency** is a stream that can be created only once. Two concurrent requests with the same key race on `no_stream`; the loser retries, finds the record and replays it.

Opening an account with an `Idempotency-Key` derives the account id from the key (UUIDv5), so a retried create lands on the same stream and collapses into one account. The seed relies on this to be safe to rerun.

The idempotency scope is `(account, key)`, and the stored request includes the operation, so reusing a key for a different payload is a 409.

## Code

```text
apps/api/src/
  server.ts                    composes the features into one Elysia app
  seed.ts                      opens the default accounts through the ledger, idempotently
  features/
    ledger/                        write side (KurrentDB)
      domain/ledger.domain.ts               rules only: enums, events, fold, decide* (no I/O)
      repositories/ledger.repository.ts     KurrentDB reads, snapshots and atomic appends
      services/ledger.service.ts            commands: read, decide, append, retry, idempotency
      routes/ledger.routes.ts               POST /accounts, /accounts/:id/deposits, /withdrawals, /transfers
    projection/                    read side (MongoDB)
      repositories/projection.repository.ts every MongoDB query
      services/projection.service.ts        projector (event -> documents) and queries
      routes/projection.routes.ts           GET /accounts, /accounts/:id

apps/api/tests/                    mirrors src/
  features/ledger/
    domain/ledger.domain.test.ts            unit tests of the rules, no database
    repositories/ledger.repository.test.ts  rehydration from a snapshot
    ledger.test.ts                          end-to-end tests against real KurrentDB and MongoDB
```

Each layer only talks to the one below it: routes → service → domain and repository. Rules never touch I/O, and queries never hold a rule.

Validation lives in the domain, not in the routes: the amount must be a positive integer, the owner name is required, and unknown accounts are a 404. Every endpoint answers `{ data }`. Errors are plain `new Error(message, { cause: status })`; one `onError` turns them into `{ message }` with that status.

## Getting started

`Docker` is the only requirement. Create `.env` in the repo root:

```text
KURRENTDB_URL=kurrentdb://localhost:2113?tls=false

MONGODB_PORT=27017
MONGODB_URL=mongodb://localhost:27017/banking-ledger

PORT=3000
API_PORT=3001
```

```bash
make up      # KurrentDB, MongoDB, seed, projector, API and web
make down    # stop everything
make test    # API tests against throwaway KurrentDB and MongoDB
```

Web on `localhost:3000`, API on `localhost:3001` (OpenAPI at `/api/docs`), KurrentDB UI on `localhost:2113`. In the web app, pick an account and run the concurrency lab: with an idempotency key four parallel deposits collapse into one; without it all four apply and none is lost.

## Where the guarantee ends

```text
covered
  atomic, append-only writes across accounts
  idempotent effect per (account, key)
  optimistic concurrency without lost updates
  full audit trail: the stream is the history
  bounded rehydration: at most SNAPSHOT_EVERY events replayed per command
  effectively-once projection into MongoDB (idempotent writes + checkpoint)

not covered
  snapshot schema versioning (change the fold -> delete the snapshot streams)
  read-your-writes on queries, currencies/FX, authentication
  external payment rails, HA/DR, more than one projector instance at a time
```

## Preview

![PREVIEW](./apps/web/public/preview.png)
