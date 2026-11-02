import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Master data, owned by Postgres and changed only through migrations.
export const users = pgTable("users", {
	id: text("id").primaryKey().default(sql`uuidv7()::text`),
	name: text("name").notNull(),
});

// Read model projected from KurrentDB. Disposable: truncate accounts, transactions and checkpoint
// and the projector rebuilds them from the events.
export const accounts = pgTable("accounts", {
	userId: text("user_id")
		.primaryKey()
		.references(() => users.id),
	balance: bigint("balance", { mode: "number" }).notNull().default(0),
});

export const transactions = pgTable(
	"transactions",
	{
		id: text("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id),
		type: text("type").notNull(),
		amount: bigint("amount", { mode: "number" }).notNull(),
		counterpartyUserId: text("counterparty_user_id").references(() => users.id),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		// $all commit position: the true event order.
		position: bigint("position", { mode: "bigint" }).notNull(),
	},
	(table) => [index("transactions_user_position").on(table.userId, table.position.desc())],
);

// Last $all position applied, written in the same transaction as the projection.
export const checkpoint = pgTable(
	"checkpoint",
	{
		id: boolean("id").primaryKey().default(true),
		commit: bigint("commit", { mode: "bigint" }).notNull(),
		prepare: bigint("prepare", { mode: "bigint" }).notNull(),
	},
	(table) => [check("checkpoint_single_row", sql`${table.id}`)],
);
