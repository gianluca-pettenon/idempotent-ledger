## What this is

An event-sourced ledger with CQRS, split into processes that only meet through the event store:

- **KurrentDB** ([formerly EventStoreDB](https://www.kurrent.io/)) is the source of truth. Every fact, from opening an account to moving money, is an immutable event.
- **MongoDB** holds the read model: one document per account and one per statement line, projected from the events.
- **api** decides and appends. **balances-projector** and **statements-projector** each subscribe and write their own view in MongoDB. Each scales and fails on its own: the API is stateless, so it can run many replicas, and optimistic concurrency keeps them consistent.

It is not a payment rail or a bank core. It shows idempotent commands, optimistic concurrency, atomic multi-account writes, and a rebuildable read model.

```mermaid
flowchart LR
    client([Client])
    api["api<br/>decides on the stream's fold"]
    kurrent[("KurrentDB<br/>event streams")]
    balances["balances-projector"]
    statements["statements-projector"]
    mongo[("MongoDB<br/>accounts, transactions")]

    client -- "POST (commands)" --> api
    api -- append --> kurrent
    kurrent -- "subscribeToAll + checkpoint" --> balances
    kurrent -- "subscribeToAll + checkpoint" --> statements
    balances -- accounts --> mongo
    statements -- transactions --> mongo
    client -- "GET (queries)" --> api
    api -- find --> mongo
```

## Model

One stream per account. The account exists once its stream holds `AccountCreated`. Every event carries the `accountId` it belongs to.

```text
Account-{accountId}    AccountCreated   { accountId, ownerName }
                       MoneyDeposited   { accountId, amount }
                       MoneyWithdrawn   { accountId, amount }
                       TransferSent     { accountId, transferId, counterpartyAccountId, amount }
                       TransferReceived { accountId, transferId, counterpartyAccountId, amount }
Snapshot-{accountId}   AccountSnapshot  { balance, revision }
Idempotency-{key}      RequestProcessed { balance }
```

```text
balance = Σ MoneyDeposited + Σ TransferReceived − Σ MoneyWithdrawn − Σ TransferSent
```

Commands rebuild the account from the event store, never from MongoDB, so a lagging read model can never let a withdrawal or transfer through without funds. Every 100 events the balance is saved to `Snapshot-{accountId}`; loading an account reads the latest snapshot and only the events after it.

Corrections are new events, never edits.

## Read model

Each view of the read model has its own projector: a separate process with its own catch-up subscription on `$all` (filtered to `Account-*`), its own checkpoint and its own collection. They all read the same events and never talk to each other.

```mermaid
flowchart LR
    created["AccountCreated"]
    movement["Money* / Transfer*"]
    balances["balances-projector"]
    statements["statements-projector"]
    accounts[("accounts<br/>_id, ownerName, balance, version")]
    transactions[("transactions<br/>_id = eventId, accountId, type, amount, counterpartyAccountId")]

    created -- "insert, balance 0" --> balances
    movement -- "$inc balance, version = stream revision" --> balances
    balances --> accounts
    movement -- "one line per event" --> statements
    statements --> transactions
```

So one view can fail, lag, be rebuilt or be deployed without touching the others, and a new view (a report, notifications) starts from the first event and gets the whole history. The counterparty's name is joined at read time (`$lookup` on `accounts`), so the statements projector depends on no other view.

There are no multi-document transactions. Every write is idempotent instead: statement lines are upserted by event id, and the balance only moves when the event is newer than the account's `version`. The `$all` position is saved after each event, so a crash replays at most one event, harmlessly.

The read model is disposable: drop a collection and its checkpoint, and its projector rebuilds it from the events. Reads are eventually consistent, typically a few milliseconds behind the writes, and the two views may briefly disagree with each other.

## A command

```mermaid
flowchart TD
    start(["POST /transfers<br/>Idempotency-Key: K"])
    key{"1. Idempotency-K<br/>exists?"}
    replay(["replay saved result<br/>(duplicate)"])
    read["2. read both accounts<br/>latest snapshot + newer events"]
    decide{"3. insufficient funds?"}
    invalid(["422"])
    append{"4. one atomic multi-stream append<br/>Account-from, expected r1: TransferSent<br/>Account-to, expected r2: TransferReceived<br/>Idempotency-K, expected no stream: RequestProcessed"}
    done(["processed"])

    start --> key
    key -- "yes" --> replay
    key -- "no" --> read
    read --> decide
    decide -- "violated" --> invalid
    decide -- "ok" --> append
    append -- "committed" --> done
    append -- "wrong expected revision:<br/>someone wrote first" --> key
```

- **Optimistic concurrency** is the stream revision. No locks; a conflicting append fails and the command retries from a fresh read.
- **Atomic transfers**: both legs and the idempotency record commit together or not at all (`multiStreamAppend`, KurrentDB 25.1+).
- **Idempotency** is a stream that can be created only once. Two concurrent requests with the same key race on `no_stream`; the loser retries, finds the record and replays it.
- **Idempotency lives in the event store** because it is written in the same atomic append as the money. A key kept in Redis or the read model would be a dual write: a crash between the two either loses the key (the retry moves money twice) or keeps a key for an append that never happened.

Accounts are not opened by the API: they come from an external, one-off migration that appends `AccountCreated` to each `Account-{id}` stream.

Without `Idempotency-Key`, every request is processed. With it, the request is processed once and every retry replays the saved response.

## Code

```text
apps/api/src/
  server.ts                         composes the features into one Elysia app
  features/
    ledger/                         write side (KurrentDB)
      ledger.events.ts              event types and the balance delta of each
      ledger.store.ts               load account (snapshot + events), atomic append, snapshots
      ledger.service.ts             commands: idempotency, funds check, optimistic retry
      ledger.routes.ts              POST /accounts/:id/deposits, /withdrawals, /transfers
    projection/                     read side (MongoDB)
      projection.store.ts           collections and checkpoints
      projector.ts                  projector runner (subscription + checkpoint)
      balances.projector.ts         accounts view: owner and balance
      statements.projector.ts       transactions view: one line per movement
      projection.routes.ts          GET /accounts, /accounts/:id

apps/api/tests/features/ledger/ledger.test.ts   end-to-end against real KurrentDB and MongoDB
```

The only business rule is the funds check. Every endpoint answers `{ data }`. Errors are plain `new Error(message, { cause: status })`; one `onError` turns them into `{ message }` with that status.

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
make up      # KurrentDB, MongoDB, projectors, API and web
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
  effectively-once projection into MongoDB (idempotent writes + checkpoint)

not covered
  snapshots (every command replays the whole account stream), idempotency-record expiry, input validation beyond the amount
  read-your-writes on queries, currencies/FX, authentication
  external payment rails, HA/DR, more than one instance of the same projector (persistent subscriptions would partition by account)
```

## Preview

![PREVIEW](./apps/web/public/preview.png)
