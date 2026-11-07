-include .env
export

.PHONY: up migrate down

up:
	docker compose up -d --build

migrate:
	docker compose run --rm api x drizzle-kit migrate

down:
	docker compose down
