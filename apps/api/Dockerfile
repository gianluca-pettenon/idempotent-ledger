FROM oven/bun:1.4.2-alpine AS dependencies

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2-alpine

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared

COPY --from=dependencies /app/apps/api/node_modules ./apps/api/node_modules

ENV NODE_ENV=production

USER bun

EXPOSE 3001

CMD ["bun", "run", "--filter", "@banking-ledger/api", "start"]
