FROM oven/bun:1.4.4-alpine AS build

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

RUN bun run --filter '@idempotent-ledger/web' build

FROM caddy:2-alpine

COPY --from=build /app/apps/web/dist /srv
COPY apps/web/Caddyfile /etc/caddy/Caddyfile

EXPOSE 3000
