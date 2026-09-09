CREATE TYPE "public"."entry_type" AS ENUM('debit', 'credit');
CREATE TYPE "public"."transaction_type" AS ENUM('deposit', 'withdraw', 'transfer');
CREATE TABLE "accounts" (
        "id" uuid DEFAULT uuidv7() PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_balance_check" CHECK ("accounts"."balance" >= 0)
);
CREATE TABLE "entries" (
        "id" uuid DEFAULT uuidv7() PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"type" "entry_type" NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_amount_check" CHECK ("entries"."amount" > 0)
);
CREATE TABLE "idempotency_keys" (
        "id" uuid DEFAULT uuidv7() PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" text,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
CREATE TABLE "transactions" (
        "id" uuid DEFAULT uuidv7() PRIMARY KEY NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" bigint NOT NULL,
	"request_id" uuid NOT NULL,
	"idempotency_key" text,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_check" CHECK ("transactions"."amount" > 0)
);
CREATE TABLE "users" (
        "id" uuid DEFAULT uuidv7() PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "accounts" ADD CONSTRAINT "FK_ACCOUNTS_USER_ID" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "entries" ADD CONSTRAINT "FK_ENTRIES_TRANSACTION_ID" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "entries" ADD CONSTRAINT "FK_ENTRIES_ACCOUNT_ID" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "FK_IDEMPOTENCY_KEYS_TRANSACTION_ID" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "FK_TRANSACTIONS_FROM_ACCOUNT_ID" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "FK_TRANSACTIONS_TO_ACCOUNT_ID" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "IDX_ACCOUNTS_USER_ID" ON "accounts" USING btree ("user_id");
CREATE INDEX "IDX_ENTRIES_TRANSACTION_ID" ON "entries" USING btree ("transaction_id");
CREATE INDEX "IDX_ENTRIES_ACCOUNT_ID_CREATED_AT" ON "entries" USING btree ("account_id","created_at");
CREATE UNIQUE INDEX "IDX_IDEMPOTENCY_KEYS_SCOPE_KEY" ON "idempotency_keys" USING btree ("scope","key");
CREATE INDEX "IDX_IDEMPOTENCY_KEYS_TRANSACTION_ID" ON "idempotency_keys" USING btree ("transaction_id");
CREATE INDEX "IDX_TRANSACTIONS_REQUEST_ID" ON "transactions" USING btree ("request_id");
CREATE INDEX "IDX_TRANSACTIONS_FROM_ACCOUNT_ID" ON "transactions" USING btree ("from_account_id");
CREATE INDEX "IDX_TRANSACTIONS_TO_ACCOUNT_ID" ON "transactions" USING btree ("to_account_id");
