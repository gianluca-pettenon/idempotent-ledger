-include .env
export

COMPOSE      := docker compose
NETWORK      := banking-ledger_default
DB_TOOLS     := banking-ledger-db-tools
DATABASE_URL := postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@postgres:$(POSTGRES_PORT)/$(POSTGRES_DB)

.PHONY: up down migrate studio

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

migrate:
	$(COMPOSE) up -d --wait postgres
	docker build -q -f packages/db/Dockerfile -t $(DB_TOOLS) .
	docker run --rm --network $(NETWORK) -e DATABASE_URL=$(DATABASE_URL) $(DB_TOOLS) bun run db:migrate

studio:
	$(COMPOSE) up -d --wait postgres
	docker build -q -f packages/db/Dockerfile -t $(DB_TOOLS) .
	docker run --rm -p 4983:4983 --network $(NETWORK) -e DATABASE_URL=$(DATABASE_URL) $(DB_TOOLS) bun run db:studio
