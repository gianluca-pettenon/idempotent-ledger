-include .env
export

COMPOSE := docker compose
TEST_ES := banking-ledger-kurrentdb-test
TEST_PG := banking-ledger-postgres-test

.PHONY: up down test

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

# Throwaway KurrentDB and Postgres so tests never touch dev data.
test:
	docker run -d --rm --name $(TEST_ES) -p 2114:2113 -e KURRENTDB_INSECURE=true -e KURRENTDB_MEM_DB=true docker.kurrent.io/kurrent-latest/kurrentdb:26.1 >/dev/null
	docker run -d --rm --name $(TEST_PG) -p 5433:5432 -e POSTGRES_PASSWORD=test --tmpfs /var/lib/postgresql postgres:18-alpine >/dev/null
	until curl -sf http://localhost:2114/health/live >/dev/null && docker exec $(TEST_PG) pg_isready -U postgres -h localhost >/dev/null; do sleep 1; done
	KURRENTDB_URL="kurrentdb://localhost:2114?tls=false" DATABASE_URL="postgresql://postgres:test@localhost:5433/postgres" bun test apps/api; \
	status=$$?; docker stop $(TEST_ES) $(TEST_PG) >/dev/null; exit $$status
