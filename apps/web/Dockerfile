FROM oven/bun:1.4.2

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

EXPOSE 3000

CMD ["bun", "run", "--filter", "@banking-ledger/web", "dev", "--", "--host", "0.0.0.0"]
