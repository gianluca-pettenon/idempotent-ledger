-include .env
export

COMPOSE := docker compose
TEST_ES := banking-ledger-kurrentdb-test
TEST_MONGO := banking-ledger-mongodb-test

.PHONY: up down test

up:
	$(COMPOSE) up -d --build

down:
	$(COMPOSE) down

# Throwaway KurrentDB and MongoDB so tests never touch dev data.
test:
	docker run -d --rm --name $(TEST_ES) -p 2114:2113 -e KURRENTDB_INSECURE=true -e KURRENTDB_MEM_DB=true docker.kurrent.io/kurrent-latest/kurrentdb:26.1 >/dev/null
	docker run -d --rm --name $(TEST_MONGO) -p 27018:27017 --tmpfs /data/db mongo:8 >/dev/null
	until curl -sf http://localhost:2114/health/live >/dev/null && docker exec $(TEST_MONGO) mongosh --quiet --eval "db.runCommand({ ping: 1 })" >/dev/null 2>&1; do sleep 1; done
	KURRENTDB_URL="kurrentdb://localhost:2114?tls=false" MONGODB_URL="mongodb://localhost:27018/banking-ledger" bun test apps/api; \
	status=$$?; docker stop $(TEST_ES) $(TEST_MONGO) >/dev/null; exit $$status
