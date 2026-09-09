FROM oven/bun:1.4.2 AS dependencies

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api ./apps/api
COPY packages/ledger ./packages/ledger
COPY packages/terms ./packages/terms

ENV NODE_ENV=production

EXPOSE 3001

CMD ["bun", "run", "--filter", "@banking-ledger/api", "start"]
