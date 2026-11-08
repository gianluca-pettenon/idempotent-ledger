# Idempotent Ledger

An event-sourced ledger with CQRS. It demonstrates idempotent commands, optimistic concurrency, atomic multi-account writes and a rebuildable read model. It is not a payment rail or a bank core.

![Preview](./apps/web/public/preview.png)

## Architecture

The write and read sides are separate processes that only meet through the event store.

| Component | Role | Technology |
| --- | --- | --- |
| **KurrentDB** ([formerly EventStoreDB](https://www.kurrent.io/)) | Source of truth: every fact is an immutable event | KurrentDB 26.2 |
| **MongoDB** | Disposable read model: account owners and statement lines | MongoDB 9.0 |
| **api** | Decides and appends commands, answers queries | Bun, Elysia |
| **projections** | Runs every projector, each in its own KurrentDB consumer group | Bun (same image as `api`) |
| **web** | Account view and concurrency lab | React 19, Vite, Tailwind, served by Caddy |

`api` and `projections` hold no state. Optimistic concurrency keeps concurrent API writers consistent, and consumer groups share events across projection replicas (`compose.yml` runs two).

```mermaid
flowchart LR
    client([Client])
    api["api"]
    kurrent[("KurrentDB<br/>event streams")]
    accounts["accounts projector"]
    statements["statements projector"]
    mongo[("MongoDB<br/>accounts, transactions")]

    client -- "POST (commands)" --> api
    api -- "atomic append" --> kurrent
    kurrent -- "consumer group: accounts" --> accounts
    kurrent -- "consumer group: statements" --> statements
    accounts --> mongo
    statements --> mongo
    client -- "GET (queries)" --> api
    api -- "last event (balance)" --> kurrent
    api -- "owners, statement" --> mongo
```

## Event model

There is one stream per account, and every event carries its `accountId`. An account exists once its stream holds `AccountCreated`.

```text
Account-{accountId}    AccountCreated   { accountId, ownerName, balance }
                       MoneyDeposited   { accountId, amount, balance }
                       MoneyWithdrawn   { accountId, amount, balance }
                       TransferSent     { accountId, transferId, counterpartyAccountId, amount, balance }
                       TransferReceived { accountId, transferId, counterpartyAccountId, amount, balance }
Idempotency-{key}      RequestProcessed { balance }
```

Every event carries the balance it leaves behind, so each one is a snapshot written in the same atomic append. Loading an account reads a single event, its last, whatever the stream's length. Commands load from the event store and never from MongoDB, so a lagging read model cannot let a withdrawal or transfer through without funds.

Corrections are new events, never edits. Streams grow forever; at scale they would be closed per period, with a closing event carrying the balance into a new stream.

Accounts are not opened through the API. `apps/api/scripts/migrate.ts` is a one-off migration that appends `AccountCreated` for three demo accounts. It can be re-run safely, because each append expects `no_stream`.

## Commands

```mermaid
flowchart TD
    start(["POST with Idempotency-Key: K"])
    key{"1. Idempotency-K<br/>exists?"}
    replay(["replay saved result<br/>outcome: duplicate"])
    read["2. read the last event of each account<br/>balance and revision"]
    decide{"3. enough funds?<br/>(withdrawals, transfers)"}
    invalid(["422"])
    append{"4. one atomic multi-stream append<br/>account streams at expected revisions<br/>Idempotency-K at no_stream"}
    done(["outcome: processed"])
    busy(["409 after 10 attempts"])

    start --> key
    key -- "yes" --> replay
    key -- "no" --> read
    read --> decide
    decide -- "no" --> invalid
    decide -- "yes" --> append
    append -- "committed" --> done
    append -- "wrong expected revision" --> key
    key -. "attempts exhausted" .-> busy
```

- **Optimistic concurrency** uses the stream revision. There are no locks: a conflicting append fails and the command retries from a fresh read, up to 10 attempts.
- **Atomic transfers**: both legs and the idempotency record commit together or not at all (`multiStreamAppend`, KurrentDB 25.1+).
- **Idempotency** is a stream that can only be created once. Concurrent requests with the same key race on `no_stream`; the loser retries, finds the record and replays it.
- **The idempotency record lives in the event store** because it shares the atomic append with the money. A key kept in Redis or the read model would be a dual write: a crash between the two either loses the key, moving money twice on retry, or keeps a key for an append that never happened.

`Idempotency-Key` is optional. Without it every request is processed; with it the request takes effect once and retries replay the saved result. Only committed commands are recorded, so a request rejected with `422` is evaluated again on retry.

## Read model

Each view has its own projector and its own persistent subscription on `$all`, filtered to `Account-*`. KurrentDB keeps each group's checkpoint, retries failed events and parks them after too many attempts, so one broken view does not stall the others.

```mermaid
flowchart LR
    created["AccountCreated"]
    movement["Money* / Transfer*"]
    accountsProjector["accounts projector"]
    statementsProjector["statements projector"]
    accounts[("accounts<br/>_id, ownerName")]
    transactions[("transactions<br/>_id, accountId, type, amount,<br/>counterpartyAccountId, version, createdAt")]

    created -- "owner" --> accountsProjector
    created -- "opening line" --> statementsProjector
    movement -- "one line per event" --> statementsProjector
    accountsProjector --> accounts
    statementsProjector --> transactions
```

Replicas mean events can arrive out of order or twice, so writes are idempotent and order-independent: statement lines are upserted by event id, and the account document is keyed by account id. The statement is sorted by stream revision, and the counterparty's name is joined at read time (`$lookup` on `accounts`), so the statements projector depends on no other view.

Balance is deliberately not in the read model. `GET /api/accounts/:accountId` reads it from the last event of the stream, so it is never stale, while the statement can trail it slightly.

To rebuild a view, drop its collection and reset its consumer group to the start. A new view gets the whole history the same way.

## Getting started

Requires Docker. Create `.env` in the repository root:

```text
MONGODB_PORT=27017
PORT=3000
API_PORT=3001
```

Start the stack, then create the demo accounts:

```bash
make up
```

```bash
make migrate
```

```bash
make down
```