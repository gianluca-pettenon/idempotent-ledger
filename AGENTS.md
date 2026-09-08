# AGENTS.md

Instructions for any AI agent (Codex, Cursor, Copilot, Windsurf, etc.) working in this repository.

## About the project

Monorepo for a **double-entry ledger**.

- `apps/web` — frontend in **React + Vite**, managed with **Bun**
- `apps/api` — backend in **Elysia**, running on **Bun**
- Critical domain: financial transactions, idempotency, concurrency, and ledger integrity.
  Bugs here aren't "just bugs" — they can mean duplicated, lost, or out-of-sync money.

## Commands

```bash
bun install     # install dependencies (root and workspaces)
bun dev         # start dev environment (web + api)
bun test        # run the full test suite
```

Always run `bun test` before considering any task done. If you touched transaction, ledger, or idempotency code, this is mandatory, not optional.

## Conventions

- Strict TypeScript across the repo. Don't use `any` without an explicit justification comment.
- Every API endpoint that creates or modifies a transaction must accept an **idempotency key** and be safe to retry.
- Every ledger movement is **double-entry**: debit and credit must always balance. Never write logic that inserts only one side of an entry.
- Concurrent operations on the same balance/account must use optimistic locking or a database transaction — never "read, compute, write" without protection against race conditions.
- Database migrations: never modify a migration that's already been committed; always create a new one.

## Roles (for spec → plan → implementation → review workflows)

Use these sections as "personas" when asking an agent for help at each phase of the work.

### Product Owner
When defining the scope of a new feature, produce:
- Description of expected behavior
- Explicit acceptance criteria
- Edge cases relevant to the domain (e.g. duplicate retry, failure mid-transaction, insufficient balance, concurrency between two operations on the same account)
- What's out of scope

### Tech Lead
When planning implementation, produce:
- Implementation plan broken into small, reviewable steps
- Concurrency or idempotency risk points the task touches
- If the change crosses `apps/web` and `apps/api`, clarify the contract (types/schema) between them before implementing

### Dev
When implementing:
- Follow the Tech Lead's plan step by step, don't skip steps
- Every write to the ledger is atomic (database transaction) and idempotent
- Write tests alongside the code, not after
- Run `bun test` before reporting the task as done

### QA
When reviewing:
- Don't validate only the happy path. Explicitly test:
  - Idempotency: the same request sent twice should have the same effect as sending it once
  - Concurrency: two simultaneous operations on the same account must not produce an inconsistent balance
  - Ledger integrity: debits and credits must always sum to zero
- Run `bun test` and confirm the suite passes before approving
- If something isn't covered by a test, flag it before approving, not after

## Never do

- Never remove or weaken a lock/transaction to "make the test pass faster"
- Never insert a ledger entry without its corresponding debit/credit pair
- Never commit keys, tokens, or secrets to this repository