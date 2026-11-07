-include .env
export

.PHONY: up migrate down

up:
	docker compose up -d --build

migrate:
	docker compose run --rm --build api run apps/api/scripts/migrate.ts

down:
	docker compose down
