# Banking Ledger

A monorepo for a banking ledger application: user accounts, balances, and transaction history backed by PostgreSQL.

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime & package manager | [Bun](https://bun.sh) |
| API | `Bun.serve()` with route handlers (TypeScript) |
| Frontend | React 19, TypeScript, Vite 8 |
| Linting & formatting | [Biome](https://biomejs.dev) |
| Database | PostgreSQL 18 (Docker) |
| Tooling | Bun workspaces, Docker / Docker Compose |

## Project structure

```
banking-ledger/
├── apps/
│   ├── api/          # HTTP API (Bun.serve)
│   └── web/          # React SPA (Vite dev server)
├── packages/
│   └── db/           # Shared database client & schema (planned)
├── docker-compose.yml
├── Dockerfile        # API container image
└── .env              # Local environment (not committed)
```

### API routes (current)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/users` | List users |
| `GET` | `/api/accounts/:userId` | Accounts for a user |
| `POST` | `/api/accounts/:userId/transactions` | Create a transaction |

During development, the Vite dev server proxies `/api` to the API server.

## Getting started

### Prerequisites

- [Bun](https://bun.sh) 1.4+
- [Docker](https://www.docker.com/) (for PostgreSQL)

### Setup

1. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

2. Set `POSTGRES_PASSWORD` in `.env`.

3. Install dependencies:

   ```bash
   bun install
   ```

4. Start PostgreSQL:

   ```bash
   docker compose up postgres -d
   ```

5. Run API and web in parallel:

   ```bash
   bun run dev
   ```

   - Web: `http://localhost:3000` (from `PORT`)
   - API: `http://localhost:3001` (from `API_PORT`)

### Other commands

```bash
bun run dev:api     # API only (hot reload)
bun run dev:web     # Web only (Vite HMR)
bun run start       # API without hot reload
bun run --filter '@banking-ledger/web' build
bun run --filter '@banking-ledger/web' lint
bun run --filter '@banking-ledger/web' format
```

### Docker (API + Postgres)

```bash
docker compose up --build
```

This starts:

- PostgreSQL on `POSTGRES_PORT`
- API on `API_PORT`

## Conventions

### Do

- Use **Bun** for installs, scripts, and running TypeScript (`bun install`, `bun run`, `bun test`).
- Keep shared packages under `packages/` and apps under `apps/`.
- Put environment variables in the root `.env`; both API and web read from there.
- Use `Bun.serve()` route handlers for API endpoints.
- Use `Bun.sql` (or the shared `packages/db` client) for PostgreSQL — not `pg` or `postgres.js`.
- Write API handlers in `apps/api/`; put reusable DB logic in `packages/db`.
- Use React 19 patterns (the React Compiler is enabled in the web app).
- Keep TypeScript strict; match existing module style (`type: "module`, `verbatimModuleSyntax`).

### Do not

- Use **npm**, **pnpm**, or **yarn** — this repo is Bun-only.
- Add **Express**, **Fastify**, or similar HTTP frameworks; the API is `Bun.serve()`.
- Commit `.env` or secrets; use `.env.example` for documentation only.
- Run the web app with Node; use `bun run dev:web` or Vite via Bun.
- Put business logic in route stubs without going through proper validation and persistence layers.
- Bypass the `/api` prefix for backend routes (the frontend proxy expects it).

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_PASSWORD` | — | Database password (required) |
| `POSTGRES_DB` | `banking-ledger` | Database name |
| `POSTGRES_PORT` | `5432` | Database port |
| `PORT` | `3000` | Web dev server port |
| `API_PORT` | `3001` | API server port |

## Status

Early setup: API routes are stubs, `packages/db` is not wired up yet, and persistence is not implemented. PostgreSQL is configured in Docker Compose and ready for schema and migrations.
