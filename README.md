## Flow

**1. Idempotent write**

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant P as Postgres

    C->>A: POST /transfers (Idempotency-Key: K)
    A->>P: BEGIN
    A->>P: INSERT idempotency_keys (scope, K, hash) ON CONFLICT DO NOTHING
    alt First time this key is seen
        P-->>A: row reserved
        A->>P: debit + credit both accounts (version check)
        A->>P: UPDATE idempotency_keys SET response, completed_at
        A->>P: COMMIT
        A-->>C: 200 { outcome: "processed" }
    else Key already exists
        P-->>A: 0 rows (conflict)
        A->>P: SELECT the existing record
        alt same request payload
            A-->>C: 200 { outcome: "duplicate" } (saved response, nothing re-applied)
        else different payload, same key
            A-->>C: 409 key reused with a different request
        end
    end
```

**2. Concurrent write to the same account**

```mermaid
sequenceDiagram
    participant R1 as Request A
    participant R2 as Request B
    participant P as accounts row (version = 5)

    R1->>P: read balance, version = 5
    R2->>P: read balance, version = 5
    R1->>P: UPDATE ... WHERE version = 5
    P-->>R1: 1 row updated -> version = 6
    R2->>P: UPDATE ... WHERE version = 5
    P-->>R2: 0 rows, someone else already moved
    Note over R2: retry from scratch (fresh read, new attempt)
    R2->>P: read balance, version = 6
    R2->>P: UPDATE ... WHERE version = 6
    P-->>R2: 1 row updated -> version = 7
```

## Why this design

An `INSERT ... ON CONFLICT DO NOTHING` on a unique `(scope, key)` index is the only thing deciding who "wins" a race between duplicate requests — not application code. Reservation, business logic, and marking the key complete all happen inside one `db.transaction`, so a crash or a lock conflict midway rolls back the reservation too. A retried request never finds a half-finished key: either it doesn't exist yet, or it's fully committed with a saved response ready to replay.

Balances use optimistic locking instead of `SELECT ... FOR UPDATE`: a `version` column and a compare-and-swap `UPDATE ... WHERE id = ? AND version = ?`. Zero rows updated means someone else moved first, and the whole operation — idempotency check included — retries from a fresh read. This holds under plain `READ COMMITTED`, needs no row locks held across round trips, and is exactly what the web app's "Concurrency lab" demonstrates live: fire four requests at once, watch one win and three retry cleanly.

A transfer is the one operation touching two account rows at once, so it always updates them in the same fixed order (lower `id` first) no matter which account is sending and which is receiving. Two transfers moving money in opposite directions between the same two accounts would otherwise lock each other out — the same problem as two threads acquiring two mutexes in reverse order. Fixed ordering makes that deadlock structurally impossible instead of something to catch and retry.

Deposits and withdrawals only touch one account and write one ledger entry — the other side of that movement is money entering or leaving the system from outside it, and there's no vault account here to hold that leg. A transfer moves money between two accounts that both exist in the ledger, so it always writes a matching debit and credit in the same transaction — inserted together, or not at all.

## Getting started

`Docker` is the only requirement.

```bash
cp .env.local .env      # set POSTGRES_PASSWORD — Postgres refuses to start without it

make migrate            # start Postgres and apply every migration
make up                 # start Postgres, API, and web via Docker
make down               # stop all services
make studio             # opens database browser
```

Web on `localhost:3000`, API on `localhost:3001`. Open the web app, pick a user, and run the "Concurrency lab": fire deposits with the same idempotency key and watch three of four collapse into `duplicate`; drop the key and watch all four apply for real.
