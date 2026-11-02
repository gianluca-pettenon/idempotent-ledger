-include .env
export

COMPOSE := docker compose
TEST_DB := banking-ledger-kurrentdb-test

.PHONY: up down test

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

# Throwaway in-memory KurrentDB so tests never touch dev data.
test:
	docker run -d --rm --name $(TEST_DB) -p 2114:2113 -e KURRENTDB_INSECURE=true -e KURRENTDB_MEM_DB=true docker.kurrent.io/kurrent-latest/kurrentdb:26.1 >/dev/null
	until curl -sf http://localhost:2114/health/live >/dev/null; do sleep 1; done
	KURRENTDB_URL="kurrentdb://localhost:2114?tls=false" bun test apps/api; status=$$?; docker stop $(TEST_DB) >/dev/null; exit $$status
