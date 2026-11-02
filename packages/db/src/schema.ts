import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	foreignKey,
	index,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";

export const transactionType = pgEnum("transaction_type", [
	"deposit",
	"withdraw",
	"transfer",
	"reversal",
]);

export const transactionStatus = pgEnum("transaction_status", [
	"pending",
	"posted",
	"failed",
	"reversed",
]);

export const entryType = pgEnum("entry_type", ["debit", "credit"]);

export const accountKind = pgEnum("account_kind", ["customer", "settlement"]);

export const users = pgTable("users", {
	id: uuid("id").primaryKey().default(sql`uuidv7()`),
	name: text("name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accounts = pgTable(
	"accounts",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		userId: uuid("user_id"),
		kind: accountKind("kind").notNull().default("customer"),
		currency: varchar("currency", { length: 3 }).notNull().default("USD"),
		balance: bigint("balance", { mode: "bigint" }).default(sql`0`).notNull(),
		version: bigint("version", { mode: "bigint" }).default(sql`0`).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("IDX_ACCOUNTS_USER_ID").on(table.userId),
		uniqueIndex("IDX_ACCOUNTS_SETTLEMENT_CURRENCY").on(table.currency).where(sql`${table.kind} = 'settlement'`),
		foreignKey({
			name: "FK_ACCOUNTS_USER_ID",
			columns: [table.userId],
			foreignColumns: [users.id],
		}),
		check("accounts_balance_check", sql`${table.balance} >= 0`),
		check("accounts_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
		check(
			"accounts_kind_owner_check",
			sql`(${table.kind} = 'customer' AND ${table.userId} IS NOT NULL) OR (${table.kind} = 'settlement' AND ${table.userId} IS NULL)`,
		),
	],
);

export const transactions = pgTable(
	"transactions",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		type: transactionType("type").notNull(),
		status: transactionStatus("status").notNull().default("pending"),
		amount: bigint("amount", { mode: "bigint" }).notNull(),
		currency: varchar("currency", { length: 3 }).notNull(),
		requestId: uuid("request_id").notNull(),
		idempotencyKey: text("idempotency_key"),
		principalId: uuid("principal_id").notNull(),
		fromAccountId: uuid("from_account_id"),
		toAccountId: uuid("to_account_id"),
		reversalOfTransactionId: uuid("reversal_of_transaction_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("IDX_TRANSACTIONS_REQUEST_ID").on(table.requestId),
		index("IDX_TRANSACTIONS_PRINCIPAL_ID").on(table.principalId),
		index("IDX_TRANSACTIONS_FROM_ACCOUNT_ID").on(table.fromAccountId),
		index("IDX_TRANSACTIONS_TO_ACCOUNT_ID").on(table.toAccountId),
		uniqueIndex("IDX_TRANSACTIONS_REVERSAL_OF").on(table.reversalOfTransactionId),
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
		foreignKey({
			name: "FK_TRANSACTIONS_PRINCIPAL_ID",
			columns: [table.principalId],
			foreignColumns: [users.id],
		}),
		foreignKey({
			name: "FK_TRANSACTIONS_REVERSAL_OF",
			columns: [table.reversalOfTransactionId],
			foreignColumns: [table.id],
		}),
		check("transactions_amount_check", sql`${table.amount} > 0`),
		check("transactions_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
		check(
			"transactions_shape_check",
			sql`(
				${table.reversalOfTransactionId} IS NULL
				AND ${table.fromAccountId} IS NOT NULL
				AND ${table.toAccountId} IS NOT NULL
				AND (
					${table.type} = 'deposit'
					OR ${table.type} = 'withdraw'
					OR (${table.type} = 'transfer' AND ${table.fromAccountId} <> ${table.toAccountId})
				)
			) OR (
				${table.reversalOfTransactionId} IS NOT NULL
				AND ${table.fromAccountId} IS NOT NULL
				AND ${table.toAccountId} IS NOT NULL
			)`,
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
		amount: bigint("amount", { mode: "bigint" }).notNull(),
		currency: varchar("currency", { length: 3 }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("IDX_ENTRIES_TRANSACTION_ID").on(table.transactionId),
		index("IDX_ENTRIES_ACCOUNT_ID_CREATED_AT").on(table.accountId, table.createdAt),
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
		check("entries_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
	],
);

export const idempotencyKeys = pgTable(
	"idempotency_keys",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		principalId: uuid("principal_id").notNull(),
		key: text("key").notNull(),
		scope: text("scope").notNull(),
		requestHash: text("request_hash").notNull(),
		response: text("response"),
		transactionId: uuid("transaction_id"),
		legacyUnlinked: boolean("legacy_unlinked").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("IDX_IDEMPOTENCY_KEYS_PRINCIPAL_SCOPE_KEY").on(table.principalId, table.scope, table.key),
		index("IDX_IDEMPOTENCY_KEYS_TRANSACTION_ID").on(table.transactionId),
		foreignKey({
			name: "FK_IDEMPOTENCY_KEYS_TRANSACTION_ID",
			columns: [table.transactionId],
			foreignColumns: [transactions.id],
		}),
		check(
			"idempotency_financial_transaction_check",
			sql`${table.scope} NOT IN ('deposit', 'withdraw', 'transfer', 'reversal') OR ${table.completedAt} IS NULL OR ${table.transactionId} IS NOT NULL OR ${table.legacyUnlinked}`,
		),
	],
);

export const outboxEvents = pgTable(
	"outbox_events",
	{
		id: uuid("id").primaryKey().default(sql`uuidv7()`),
		aggregateId: uuid("aggregate_id").notNull(),
		eventType: text("event_type").notNull(),
		payload: text("payload").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		publishedAt: timestamp("published_at", { withTimezone: true }),
	},
	(table) => [
		index("IDX_OUTBOX_AGGREGATE_ID").on(table.aggregateId),
		index("IDX_OUTBOX_UNPUBLISHED").on(table.createdAt).where(sql`${table.publishedAt} IS NULL`),
		foreignKey({
			name: "FK_OUTBOX_AGGREGATE_ID",
			columns: [table.aggregateId],
			foreignColumns: [transactions.id],
		}),
	],
);
