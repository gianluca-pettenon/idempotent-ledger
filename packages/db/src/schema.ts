import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const transactionType = pgEnum(
  "transaction_type", [
    "deposit",
    "withdraw",
    "transfer",
  ]
);

export const entryType = pgEnum(
  "entry_type", [
    "debit",
    "credit",
  ]
);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id").notNull(),
    balance: bigint("balance", { mode: "number" }).default(0).notNull(),
    version: bigint("version", { mode: "number" }).default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("IDX_ACCOUNTS_USER_ID").on(table.userId),
    foreignKey({
      name: "FK_ACCOUNTS_USER_ID",
      columns: [table.userId],
      foreignColumns: [users.id],
    }),
    check("accounts_balance_check", sql`${table.balance} >= 0`),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    type: transactionType("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    requestId: uuid("request_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    fromAccountId: uuid("from_account_id"),
    toAccountId: uuid("to_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("IDX_TRANSACTIONS_REQUEST_ID").on(table.requestId),
    index("IDX_TRANSACTIONS_FROM_ACCOUNT_ID").on(
      table.fromAccountId,
    ),
    index("IDX_TRANSACTIONS_TO_ACCOUNT_ID").on(
      table.toAccountId,
    ),
    foreignKey({
      name: "FK_TRANSACTIONS_FROM_ACCOUNT_ID",
      columns: [table.fromAccountId],
      foreignColumns: [accounts.id],
    }),
    foreignKey({
      name: "FK_TRANSACTIONS_TO_ACCOUNT_ID",
      columns: [table.toAccountId],
      foreignColumns: [accounts.id],
    }),
    check(
      "transactions_amount_check",
      sql`${table.amount} > 0`,
    ),
  ],
);

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    transactionId: uuid("transaction_id").notNull(),
    accountId: uuid("account_id").notNull(),
    type: entryType("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("IDX_ENTRIES_TRANSACTION_ID").on(
      table.transactionId,
    ),
    index("IDX_ENTRIES_ACCOUNT_ID_CREATED_AT").on(
      table.accountId,
      table.createdAt,
    ),
    foreignKey({
      name: "FK_ENTRIES_TRANSACTION_ID",
      columns: [table.transactionId],
      foreignColumns: [transactions.id],
    }),
    foreignKey({
      name: "FK_ENTRIES_ACCOUNT_ID",
      columns: [table.accountId],
      foreignColumns: [accounts.id],
    }),
    check("entries_amount_check", sql`${table.amount} > 0`),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    key: text("key").notNull(),
    scope: text("scope").notNull(),
    requestHash: text("request_hash").notNull(),
    response: text("response"),
    transactionId: uuid("transaction_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("IDX_IDEMPOTENCY_KEYS_SCOPE_KEY").on(
      table.scope,
      table.key,
    ),
    index("IDX_IDEMPOTENCY_KEYS_TRANSACTION_ID").on(
      table.transactionId,
    ),
    foreignKey({
      name: "FK_IDEMPOTENCY_KEYS_TRANSACTION_ID",
      columns: [table.transactionId],
      foreignColumns: [transactions.id],
    }),
  ],
);
