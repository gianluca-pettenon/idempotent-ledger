-include .env
export

COMPOSE := docker compose

.PHONY: up down migrate studio

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

migrate:
	$(COMPOSE) up -d --wait postgres
	bun run db:migrate

studio:
	bun run db:studio
