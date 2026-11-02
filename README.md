## What this is

An event-sourced ledger with CQRS: [KurrentDB](https://www.kurrent.io/) (formerly EventStoreDB) is the write side and the source of truth, and Postgres is the read side, projected from the events. This is the usual shape in banks: an event log plus a relational database for queries.

It is not a payment rail or a bank core. It shows idempotent commands, optimistic concurrency, atomic multi-account writes, and a rebuildable read model.

```text
            commands                         queries
POST ...  ──────────► API ──append──► KurrentDB        API ◄──SELECT── Postgres
                       (decide on the                              ▲
                        stream's fold)          projector ─────────┘
                                         (subscribeToAll + checkpoint)
```

## Model

One stream per account, plus one stream of users:

```text
users                  UserRegistered { id, name }
account-{userId}       AccountOpened
                       MoneyDeposited   { amount }
                       MoneyWithdrawn   { amount }
                       TransferSent     { transferId, toUserId, amount }
                       TransferReceived { transferId, fromUserId, amount }
idempotency-{userId}-{key}
                       RequestProcessed { request, balance }
```

```text
balance = Σ MoneyDeposited + Σ TransferReceived − Σ MoneyWithdrawn − Σ TransferSent
```

Corrections are new events, never edits. Commands always decide on the stream itself, never on Postgres, so the invariants (no overdraft) hold even when the read model lags.

## Read model

The projector is a catch-up subscription on `$all` (filtered to `users` and `account-*`). For every event it updates `users`, `accounts.balance`, and `transactions` **and** saves the `$all` position to `checkpoint`, all in one SQL transaction. A crash or restart resumes from the checkpoint, so no event is skipped or applied twice.

The read model is disposable: drop the tables and the projector rebuilds them from the events. Reads are eventually consistent, typically a few milliseconds behind the writes.

## A command

```text
POST /transfers   Idempotency-Key: K
  |
  1. read idempotency-{user}-{K}
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

The idempotency scope is `(user, key)`, and the stored request includes the operation, so reusing a key for a different payload is a 409.

## Code

```text
apps/api/src/
  ledger.ts        write side: events, fold, commands, idempotency (KurrentDB)
  projection.ts    read side: projector and queries (Postgres)
  schema.sql       read model tables
  server.ts        HTTP (Elysia): validation and routes
  ledger.test.ts   end-to-end tests against real KurrentDB and Postgres
```

Amounts are positive integers, validated at the HTTP boundary. The seeded users are created atomically on first start.

## Getting started

`Docker` is the only requirement. Create `.env` in the repo root:

```text
KURRENTDB_URL=kurrentdb://localhost:2113?tls=false

POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=banking-ledger
POSTGRES_PORT=5432
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/banking-ledger

PORT=3000
API_PORT=3001
```

```bash
make up      # KurrentDB, Postgres, projector, API and web
make down    # stop everything
make test    # API tests against throwaway KurrentDB and Postgres
```

Web on `localhost:3000`, API on `localhost:3001` (OpenAPI at `/api/docs`), KurrentDB UI on `localhost:2113`. In the web app, pick a user and run the concurrency lab: with an idempotency key four parallel deposits collapse into one; without it all four apply and none is lost.

## Where the guarantee ends

```text
covered
  atomic, append-only writes across accounts
  idempotent effect per (user, key)
  optimistic concurrency without lost updates
  full audit trail: the stream is the history
  exactly-once projection into Postgres (checkpoint in the same transaction)

not covered
  snapshots (every command replays the stream)
  read-your-writes on queries, currencies/FX, authentication
  external payment rails, distributed exactly-once, HA/DR
```

## Preview

![PREVIEW](./apps/web/public/preview.png)
