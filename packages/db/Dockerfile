FROM oven/bun:1.4.2-alpine

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

CMD ["bun", "run", "db:migrate"]
