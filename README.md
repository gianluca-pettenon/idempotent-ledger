## What this is

A small double-entry ledger with idempotent commands, optimistic concurrency, and an outbox. It keeps customer balances as a projection of journal entries and refuses to post a transaction whose debits and credits do not match.

It is not a payment rail, a bank core, or a distributed exactly-once system. The guarantee stops at the database transaction.

```text
idempotency  ≠  exactly-once distributed processing
ledger       ≠  payment rail
```

Inside one Postgres transaction the financial effect is applied once, balanced, and recoverable by key. Outside that boundary — HTTP retries that never reached the API, a consumer that crashes after reading the outbox, an external settlement network — delivery is at least once. Consumers have to be idempotent too.

## Flow

**1. Idempotent write**

```text
Client
  |
  |  POST /transfers
  |  Idempotency-Key: K
  v
API
  |
  |  BEGIN
  |  INSERT idempotency_keys (principal, scope, K, hash)
  |     ON CONFLICT DO NOTHING
  |
  +-- reserved -------------------------------------------+
  |   post transaction (pending)                          |
  |   insert balanced entries                             |
  |   UPDATE accounts SET balance, version = version + 1 |
  |          WHERE id = ? AND version = ?                |
  |   INSERT outbox_events                                |
  |   status -> posted                                    |
  |   UPDATE idempotency_keys SET transaction_id, response|
  |   COMMIT   (deferred check: debits = credits)         |
  |                                                       |
  +-- conflict -------------------------------------------+
      same principal + scope + key + same canonical hash
        -> replay saved response, write nothing
      same key + different hash
        -> 409
```

The principal is the user who owns the command: the account owner for a deposit or withdrawal, the source user for a transfer, and the original principal for a reversal. There is no authentication layer. `Client A + key ABC` does not collide with `Client B + key ABC`, and B cannot read A's saved response.

```text
(principal_id, operation_scope, idempotency_key)
```

A completed deposit, withdrawal, transfer, or reversal cannot leave `idempotency_keys.transaction_id` null. The column is a foreign key to `transactions`. Rows that already existed and whose transaction did not survive are kept and marked `legacy_unlinked`; new commands cannot use that flag. A full reconciliation reports them and does not delete them.

**2. Concurrent write to the same account**

```text
Request A                         Request B
read balance, version = 5         read balance, version = 5
UPDATE ... WHERE version = 5      UPDATE ... WHERE version = 5
1 row, version = 6                0 rows -> OptimisticLockError
                                  retry from a fresh read
                                  UPDATE ... WHERE version = 6
                                  1 row, version = 7
```

The whole attempt, including the idempotency reservation, retries. A conflict rolls the reservation back, so a retry does not observe a half-finished key. Zero rows updated is the conflict signal. Row locks are not held across round trips; `READ COMMITTED` is enough.

Transfers, deposits, and withdrawals update every account they touch in sorted `id` order. A deposit now updates the customer account and the settlement account. Sorting both ids the same way on every command keeps opposite transfers, and deposits racing with transfers, from deadlocking.

## Double entry

Every posted transaction has at least one debit and one credit, and the sums are equal. Postgres checks that at commit with a deferred constraint trigger. A transaction that is still `pending` cannot commit. An unbalanced journal cannot become `posted`.

```text
Deposit
  Settlement     DEBIT    100
  Customer       CREDIT   100

Withdraw
  Customer       DEBIT    100
  Settlement     CREDIT   100

Transfer
  Source         DEBIT    100
  Destination    CREDIT   100
```

Settlement accounts are internal counterparties, one per currency. They are not a bank integration. Customer accounts use credit-normal balances (a credit increases what the ledger owes the customer). Settlement accounts use debit-normal balances (a debit increases cash that entered the ledger). Both stay `>= 0`.

Cross-currency transfers are rejected. There is no FX.

```text
USD -> USD    ok
USD -> EUR    rejected
```

## Transaction and entries

```text
Transaction          the financial event
  |
  +-- Entry          one posting on one account
  +-- Entry
```

Entries cannot exist without a transaction. They can be inserted only while the transaction is `pending`. After `posted`, entries are immutable.

```text
PENDING  -> POSTED
PENDING  -> FAILED     (reserved; failures roll back instead of persisting FAILED)
POSTED   -> REVERSED
```

Any other status change is rejected in Postgres, and amount, currency, accounts, and type cannot be updated. `DELETE` on `transactions` and `entries` is rejected. The session setting `ledger.maintenance=on` bypasses that guard for tests and maintenance. The financial path never sets it.

Corrections are new transactions:

```text
Transaction 100
  Debit   100
  Credit  100

Transaction 101
  reversal_of = 100
  Debit   100
  Credit  100
  original status -> reversed
```

A transaction can be reversed once. A reversal cannot be reversed. The reversal is currency-matched and created in the same database transaction as the status change and the new entries. Original entries are not edited.

## Balance

`accounts.balance` is a projection kept in the same transaction as the journal. The historical source is `entries`.

```text
customer   balance = credits - debits
settlement balance = debits - credits
```

Reconciliation is read-only. It reports, and does not repair:

```text
account
stored balance
calculated balance
difference
```

It also checks that each posted or reversed transaction has equal debit and credit sums, that entry foreign keys resolve, and that an idempotency row points at its transaction when it claims one.

## Outbox

```text
BEGIN
  insert transaction
  insert entries
  update balances
  insert outbox_events
  mark posted
COMMIT
```

The event is not published from the application after commit. `published_at` is set later by `OutboxRepository.markPublished`. Nothing here talks to Kafka or RabbitMQ. A downstream consumer must treat delivery as at least once and dedupe on the transaction id.

## Money and HTTP

Amounts and balances are `bigint` in TypeScript and `bigint` in Postgres. Nothing in the ledger coerces them to `number`.

JSON has no bigint. At the HTTP boundary only, a safe integer is parsed with `BigInt` and a bigint that fits in `Number.MAX_SAFE_INTEGER` is written back as a JSON number. Fractional amounts and values outside that range are rejected. Idempotency responses stored in the database keep bigints in a `{ "$bigint": "..." }` wrapper so a replay returns the same value the first call returned.

Request hashes use canonical JSON: object keys are sorted, so `{ amount, accountId }` and `{ accountId, amount }` are the same payload. `100` and `100n` hash as the same number. Array order is preserved.

```text
same principal + scope + key + same canonical payload  -> replay
same principal + scope + key + different payload       -> conflict
```

Amounts are integer currency units, not a fractional major-unit type. The seeded currency is `USD`, matching the web display. Accounts, transactions, and entries store an ISO 4217 code.

## Audit

Each financial transaction stores `principal_id`, `request_id`, `idempotency_key` when the caller sent one, and `created_at`. The outbox payload repeats the transaction id, type, amount (as a decimal string), currency, principal, and request id. Names and other free-text profile data are not copied into the event.

## Getting started

`Docker` is the only requirement.

Create `.env` in the repo root. Postgres refuses to start without `POSTGRES_PASSWORD`.

```text
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
POSTGRES_DB=banking-ledger
POSTGRES_PORT=5432

PORT=3000
API_PORT=3001
```

```bash
make migrate            # start Postgres and apply every migration
make up                 # start Postgres, API, and web via Docker
make down               # stop all services
make studio             # opens database browser
```

Web on `localhost:3000`, API on `localhost:3001`. Open the web app, pick a user, and run the "Concurrency lab": fire deposits with the same idempotency key and watch three of four collapse into `duplicate`; drop the key and watch all four apply for real.

`POST /transactions/:transactionId/reversals` reverses one posted transaction. Send `Idempotency-Key` to make that reversal idempotent.

## Where the guarantee ends

```text
covered here
  atomic post inside Postgres
  idempotent effect for a (principal, scope, key)
  balanced double entry
  optimistic concurrency and deterministic lock order
  append-only journal and compensating reversals
  balance projection plus read-only reconciliation
  outbox row in the same commit

not covered
  external payment rails and external settlement
  FX
  distributed exactly-once
  regulatory reporting, PCI, KYC/AML
  production HA/DR and operational monitoring
```

Passing the test suite does not make this bank-grade or production-ready. It means the invariants above hold inside this process and this database.

## Preview

![PREVIEW](./apps/web/public/preview.png)
