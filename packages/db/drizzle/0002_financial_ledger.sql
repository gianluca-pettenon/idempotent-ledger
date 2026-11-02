-- Financial ledger evolution.
--
-- Existing rows are preserved. New columns are added with temporary defaults,
-- backfilled, and only then constrained. Historical deposits and withdrawals
-- were single-sided; this migration adds the missing settlement leg and a USD
-- settlement account so posted history satisfies debits = credits.
-- Account balances already stored on customer accounts are not rewritten.
-- The settlement balance is derived from the settlement entries this migration inserts.
--
-- 'reversal' is added to transaction_type here and is not used as an enum
-- literal later in this file. PostgreSQL cannot use a value added with
-- ALTER TYPE ... ADD VALUE until the surrounding transaction commits, and
-- drizzle applies a migration inside one transaction.

CREATE TYPE "public"."account_kind" AS ENUM('customer', 'settlement');
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'posted', 'failed', 'reversed');
ALTER TYPE "public"."transaction_type" ADD VALUE 'reversal';

ALTER TABLE "accounts" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "accounts" ADD COLUMN "kind" "account_kind" DEFAULT 'customer' NOT NULL;
ALTER TABLE "accounts" ADD COLUMN "currency" varchar(3) DEFAULT 'USD' NOT NULL;

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_currency_check" CHECK ("accounts"."currency" ~ '^[A-Z]{3}$');
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_kind_owner_check" CHECK (
	("accounts"."kind" = 'customer' AND "accounts"."user_id" IS NOT NULL)
	OR ("accounts"."kind" = 'settlement' AND "accounts"."user_id" IS NULL)
);
CREATE UNIQUE INDEX "IDX_ACCOUNTS_SETTLEMENT_CURRENCY" ON "accounts" USING btree ("currency") WHERE "accounts"."kind" = 'settlement';

INSERT INTO "accounts" ("user_id", "kind", "currency", "balance", "version")
SELECT NULL, 'settlement', 'USD', 0, 0
WHERE NOT EXISTS (
	SELECT 1 FROM "accounts" WHERE "kind" = 'settlement' AND "currency" = 'USD'
);

-- Existing posted activity stays posted. New rows default to pending.
ALTER TABLE "transactions" ADD COLUMN "status" "transaction_status" DEFAULT 'posted' NOT NULL;
ALTER TABLE "transactions" ALTER COLUMN "status" SET DEFAULT 'pending';
ALTER TABLE "transactions" ADD COLUMN "currency" varchar(3) DEFAULT 'USD' NOT NULL;
ALTER TABLE "transactions" ADD COLUMN "principal_id" uuid;
ALTER TABLE "transactions" ADD COLUMN "reversal_of_transaction_id" uuid;

UPDATE "transactions" AS t
SET "principal_id" = a."user_id"
FROM "accounts" AS a
WHERE t."principal_id" IS NULL
	AND a."user_id" IS NOT NULL
	AND (
		(t."type" = 'deposit' AND a."id" = t."to_account_id")
		OR (t."type" IN ('withdraw', 'transfer') AND a."id" = t."from_account_id")
	);

DO $$
DECLARE
	missing integer;
BEGIN
	SELECT count(*) INTO missing FROM "transactions" WHERE "principal_id" IS NULL;
	IF missing > 0 THEN
		RAISE EXCEPTION 'refusing to continue: % transactions have no principal_id after backfill', missing;
	END IF;
END $$;

ALTER TABLE "transactions" ALTER COLUMN "principal_id" SET NOT NULL;
ALTER TABLE "transactions" ALTER COLUMN "currency" DROP DEFAULT;

ALTER TABLE "entries" ADD COLUMN "currency" varchar(3) DEFAULT 'USD' NOT NULL;
UPDATE "entries" AS e
SET "currency" = t."currency"
FROM "transactions" AS t
WHERE e."transaction_id" = t."id";
ALTER TABLE "entries" ALTER COLUMN "currency" DROP DEFAULT;

DO $$
DECLARE
	settlement_id uuid;
	non_usd integer;
BEGIN
	SELECT "id" INTO settlement_id
	FROM "accounts"
	WHERE "kind" = 'settlement' AND "currency" = 'USD';

	IF settlement_id IS NULL THEN
		RAISE EXCEPTION 'USD settlement account is missing';
	END IF;

	SELECT count(*) INTO non_usd
	FROM "transactions"
	WHERE "type" IN ('deposit', 'withdraw') AND "currency" <> 'USD';

	IF non_usd > 0 THEN
		RAISE EXCEPTION 'refusing to backfill % non-USD movements without a matching settlement account', non_usd;
	END IF;

	INSERT INTO "entries" ("transaction_id", "account_id", "type", "amount", "currency", "created_at")
	SELECT t."id", settlement_id, 'debit', t."amount", t."currency", t."created_at"
	FROM "transactions" AS t
	WHERE t."type" = 'deposit'
		AND NOT EXISTS (
			SELECT 1 FROM "entries" AS e
			WHERE e."transaction_id" = t."id" AND e."account_id" = settlement_id AND e."type" = 'debit'
		);

	UPDATE "transactions"
	SET "from_account_id" = settlement_id
	WHERE "type" = 'deposit' AND "from_account_id" IS NULL;

	INSERT INTO "entries" ("transaction_id", "account_id", "type", "amount", "currency", "created_at")
	SELECT t."id", settlement_id, 'credit', t."amount", t."currency", t."created_at"
	FROM "transactions" AS t
	WHERE t."type" = 'withdraw'
		AND NOT EXISTS (
			SELECT 1 FROM "entries" AS e
			WHERE e."transaction_id" = t."id" AND e."account_id" = settlement_id AND e."type" = 'credit'
		);

	UPDATE "transactions"
	SET "to_account_id" = settlement_id
	WHERE "type" = 'withdraw' AND "to_account_id" IS NULL;

	UPDATE "accounts" AS a
	SET "balance" = COALESCE((
		SELECT SUM(
			CASE
				WHEN e."type" = 'debit' THEN e."amount"
				ELSE -e."amount"
			END
		)::bigint
		FROM "entries" AS e
		WHERE e."account_id" = a."id"
	), 0)
	WHERE a."id" = settlement_id;
END $$;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_check" CHECK ("transactions"."currency" ~ '^[A-Z]{3}$');
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_shape_check" CHECK ((
	"transactions"."reversal_of_transaction_id" IS NULL
	AND "transactions"."from_account_id" IS NOT NULL
	AND "transactions"."to_account_id" IS NOT NULL
	AND (
		"transactions"."type" = 'deposit'
		OR "transactions"."type" = 'withdraw'
		OR ("transactions"."type" = 'transfer' AND "transactions"."from_account_id" <> "transactions"."to_account_id")
	)
) OR (
	"transactions"."reversal_of_transaction_id" IS NOT NULL
	AND "transactions"."from_account_id" IS NOT NULL
	AND "transactions"."to_account_id" IS NOT NULL
));
ALTER TABLE "entries" ADD CONSTRAINT "entries_currency_check" CHECK ("entries"."currency" ~ '^[A-Z]{3}$');

ALTER TABLE "transactions" ADD CONSTRAINT "FK_TRANSACTIONS_PRINCIPAL_ID" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "FK_TRANSACTIONS_REVERSAL_OF" FOREIGN KEY ("reversal_of_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "IDX_TRANSACTIONS_PRINCIPAL_ID" ON "transactions" USING btree ("principal_id");
CREATE UNIQUE INDEX "IDX_TRANSACTIONS_REVERSAL_OF" ON "transactions" USING btree ("reversal_of_transaction_id");

ALTER TABLE "idempotency_keys" ADD COLUMN "principal_id" uuid;
ALTER TABLE "idempotency_keys" ADD COLUMN "legacy_unlinked" boolean DEFAULT false NOT NULL;

UPDATE "idempotency_keys" AS k
SET "transaction_id" = matched."id"
FROM (
	SELECT "idempotency_key", (array_agg("id" ORDER BY "created_at"))[1] AS "id", count(*) AS "n"
	FROM "transactions"
	WHERE "idempotency_key" IS NOT NULL
	GROUP BY "idempotency_key"
) AS matched
WHERE k."transaction_id" IS NULL
	AND k."key" = matched."idempotency_key"
	AND k."scope" IN ('deposit', 'withdraw', 'transfer')
	AND matched."n" = 1;

UPDATE "idempotency_keys" AS k
SET "principal_id" = t."principal_id"
FROM "transactions" AS t
WHERE k."principal_id" IS NULL
	AND k."transaction_id" = t."id";

-- Rows that cannot be tied to a user keep a synthetic principal so the unique
-- scope stays isolated. They are not deleted.
UPDATE "idempotency_keys"
SET "principal_id" = uuidv7()
WHERE "principal_id" IS NULL;

-- Completed financial keys whose transaction row did not survive (test cleanup
-- or the previous nullable transaction_id) are preserved and flagged. New rows
-- default this flag to false and must point at a transaction.
UPDATE "idempotency_keys"
SET "legacy_unlinked" = true
WHERE "scope" IN ('deposit', 'withdraw', 'transfer', 'reversal')
	AND "completed_at" IS NOT NULL
	AND "transaction_id" IS NULL;

ALTER TABLE "idempotency_keys" ALTER COLUMN "principal_id" SET NOT NULL;
DROP INDEX "IDX_IDEMPOTENCY_KEYS_SCOPE_KEY";
CREATE UNIQUE INDEX "IDX_IDEMPOTENCY_KEYS_PRINCIPAL_SCOPE_KEY" ON "idempotency_keys" USING btree ("principal_id", "scope", "key");
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_financial_transaction_check" CHECK (
	"idempotency_keys"."scope" NOT IN ('deposit', 'withdraw', 'transfer', 'reversal')
	OR "idempotency_keys"."completed_at" IS NULL
	OR "idempotency_keys"."transaction_id" IS NOT NULL
	OR "idempotency_keys"."legacy_unlinked"
);

CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
ALTER TABLE "outbox_events" ADD CONSTRAINT "FK_OUTBOX_AGGREGATE_ID" FOREIGN KEY ("aggregate_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "IDX_OUTBOX_AGGREGATE_ID" ON "outbox_events" USING btree ("aggregate_id");
CREATE INDEX "IDX_OUTBOX_UNPUBLISHED" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."published_at" IS NULL;

-- Append-only guard. ledger.maintenance=on is an explicit operational escape
-- used by tests and maintenance; the financial path never sets it.
CREATE OR REPLACE FUNCTION forbid_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF current_setting('ledger.maintenance', true) = 'on' THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RETURN NEW;
	END IF;

	RAISE EXCEPTION 'append-only: % on % is forbidden', TG_OP, TG_TABLE_NAME
		USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION enforce_transaction_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF current_setting('ledger.maintenance', true) = 'on' THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'append-only: DELETE on transactions is forbidden'
			USING ERRCODE = '55000';
	END IF;

	IF NEW."amount" IS DISTINCT FROM OLD."amount"
		OR NEW."type" IS DISTINCT FROM OLD."type"
		OR NEW."currency" IS DISTINCT FROM OLD."currency"
		OR NEW."from_account_id" IS DISTINCT FROM OLD."from_account_id"
		OR NEW."to_account_id" IS DISTINCT FROM OLD."to_account_id"
		OR NEW."reversal_of_transaction_id" IS DISTINCT FROM OLD."reversal_of_transaction_id"
		OR NEW."principal_id" IS DISTINCT FROM OLD."principal_id"
		OR NEW."request_id" IS DISTINCT FROM OLD."request_id"
		OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
	THEN
		RAISE EXCEPTION 'append-only: financial transaction columns are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF OLD."status" = NEW."status" THEN
		RETURN NEW;
	END IF;

	IF OLD."status" = 'pending' AND NEW."status" IN ('posted', 'failed') THEN
		RETURN NEW;
	END IF;

	IF OLD."status" = 'posted' AND NEW."status" = 'reversed' THEN
		RETURN NEW;
	END IF;

	RAISE EXCEPTION 'invalid transaction status transition % -> %', OLD."status", NEW."status"
		USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION assert_transaction_on_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	from_kind account_kind;
	from_currency varchar(3);
	to_kind account_kind;
	to_currency varchar(3);
	original_status transaction_status;
	original_currency varchar(3);
	original_reversal uuid;
BEGIN
	IF NEW."from_account_id" IS NULL OR NEW."to_account_id" IS NULL THEN
		RAISE EXCEPTION 'transaction % requires both accounts', NEW."type";
	END IF;

	SELECT "kind", "currency" INTO from_kind, from_currency FROM "accounts" WHERE "id" = NEW."from_account_id";
	SELECT "kind", "currency" INTO to_kind, to_currency FROM "accounts" WHERE "id" = NEW."to_account_id";

	IF from_currency IS NULL OR to_currency IS NULL THEN
		RAISE EXCEPTION 'transaction accounts must exist';
	END IF;

	IF from_currency <> NEW."currency" OR to_currency <> NEW."currency" OR from_currency <> to_currency THEN
		RAISE EXCEPTION 'currency mismatch';
	END IF;

	-- Compare via text so this function can be created in the same transaction
	-- that adds the enum label. The label is not used until a later transaction.
	IF NEW."reversal_of_transaction_id" IS NOT NULL THEN
		IF NEW."type"::text <> 'reversal' THEN
			RAISE EXCEPTION 'only a reversal transaction can set reversal_of_transaction_id';
		END IF;

		SELECT "status", "currency", "reversal_of_transaction_id"
		INTO original_status, original_currency, original_reversal
		FROM "transactions"
		WHERE "id" = NEW."reversal_of_transaction_id";

		IF original_status IS NULL THEN
			RAISE EXCEPTION 'reversal target does not exist';
		END IF;

		IF original_reversal IS NOT NULL THEN
			RAISE EXCEPTION 'cannot reverse a reversal';
		END IF;

		IF original_status <> 'posted' THEN
			RAISE EXCEPTION 'only a posted transaction can be reversed';
		END IF;

		IF original_currency <> NEW."currency" THEN
			RAISE EXCEPTION 'currency mismatch';
		END IF;

		RETURN NEW;
	END IF;

	IF NEW."type"::text = 'reversal' THEN
		RAISE EXCEPTION 'reversal requires reversal_of_transaction_id';
	END IF;

	IF NEW."type" = 'deposit' AND (from_kind <> 'settlement' OR to_kind <> 'customer') THEN
		RAISE EXCEPTION 'deposit must move from settlement to a customer account';
	END IF;

	IF NEW."type" = 'withdraw' AND (from_kind <> 'customer' OR to_kind <> 'settlement') THEN
		RAISE EXCEPTION 'withdraw must move from a customer account to settlement';
	END IF;

	IF NEW."type" = 'transfer' AND (from_kind <> 'customer' OR to_kind <> 'customer' OR NEW."from_account_id" = NEW."to_account_id") THEN
		RAISE EXCEPTION 'transfer must move between two distinct customer accounts';
	END IF;

	RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assert_entry_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	tx_status transaction_status;
	tx_currency varchar(3);
	account_currency varchar(3);
BEGIN
	SELECT "status", "currency" INTO tx_status, tx_currency
	FROM "transactions"
	WHERE "id" = NEW."transaction_id";

	IF tx_status IS NULL THEN
		RAISE EXCEPTION 'entry transaction does not exist';
	END IF;

	IF tx_status <> 'pending' THEN
		RAISE EXCEPTION 'entries can only be added to a pending transaction';
	END IF;

	SELECT "currency" INTO account_currency FROM "accounts" WHERE "id" = NEW."account_id";

	IF account_currency IS NULL THEN
		RAISE EXCEPTION 'entry account does not exist';
	END IF;

	IF NEW."currency" <> tx_currency OR NEW."currency" <> account_currency THEN
		RAISE EXCEPTION 'currency mismatch';
	END IF;

	RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION assert_transaction_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	current_status transaction_status;
	debit_sum bigint;
	credit_sum bigint;
BEGIN
	SELECT "status" INTO current_status FROM "transactions" WHERE "id" = NEW."id";

	IF current_status IS NULL THEN
		RETURN NULL;
	END IF;

	IF current_status = 'pending' THEN
		RAISE EXCEPTION 'cannot commit while pending: transaction %', NEW."id";
	END IF;

	IF current_status = 'failed' THEN
		RETURN NEW;
	END IF;

	SELECT
		COALESCE(SUM("amount") FILTER (WHERE "type" = 'debit'), 0)::bigint,
		COALESCE(SUM("amount") FILTER (WHERE "type" = 'credit'), 0)::bigint
	INTO debit_sum, credit_sum
	FROM "entries"
	WHERE "transaction_id" = NEW."id";

	IF debit_sum <> credit_sum OR debit_sum = 0 THEN
		RAISE EXCEPTION 'unbalanced transaction %: debits % credits %', NEW."id", debit_sum, credit_sum;
	END IF;

	RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_entries_append_only"
BEFORE UPDATE OR DELETE ON "entries"
FOR EACH ROW
EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER "trg_transactions_append_only"
BEFORE UPDATE OR DELETE ON "transactions"
FOR EACH ROW
EXECUTE FUNCTION enforce_transaction_transition();

CREATE TRIGGER "trg_transactions_on_insert"
BEFORE INSERT ON "transactions"
FOR EACH ROW
EXECUTE FUNCTION assert_transaction_on_insert();

CREATE TRIGGER "trg_entries_on_insert"
BEFORE INSERT ON "entries"
FOR EACH ROW
EXECUTE FUNCTION assert_entry_insert();

CREATE CONSTRAINT TRIGGER "trg_transactions_balanced"
AFTER INSERT OR UPDATE OF "status" ON "transactions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION assert_transaction_balanced();

DO $$
DECLARE
	bad_tx integer;
	bad_accounts integer;
BEGIN
	SELECT count(*) INTO bad_tx
	FROM (
		SELECT t."id"
		FROM "transactions" AS t
		LEFT JOIN "entries" AS e ON e."transaction_id" = t."id"
		WHERE t."status" IN ('posted', 'reversed')
		GROUP BY t."id"
		HAVING COALESCE(SUM(e."amount") FILTER (WHERE e."type" = 'debit'), 0)
			<> COALESCE(SUM(e."amount") FILTER (WHERE e."type" = 'credit'), 0)
	) AS unbalanced;

	IF bad_tx > 0 THEN
		RAISE EXCEPTION 'migration backfill left % unbalanced transactions', bad_tx;
	END IF;

	SELECT count(*) INTO bad_accounts
	FROM (
		SELECT a."id"
		FROM "accounts" AS a
		LEFT JOIN "entries" AS e ON e."account_id" = a."id"
		GROUP BY a."id", a."balance", a."kind"
		HAVING a."balance" <> COALESCE(SUM(
			CASE
				WHEN a."kind" = 'customer' AND e."type" = 'credit' THEN e."amount"
				WHEN a."kind" = 'customer' AND e."type" = 'debit' THEN -e."amount"
				WHEN a."kind" = 'settlement' AND e."type" = 'debit' THEN e."amount"
				WHEN a."kind" = 'settlement' AND e."type" = 'credit' THEN -e."amount"
				ELSE 0
			END
		), 0)
	) AS drifted;

	IF bad_accounts > 0 THEN
		RAISE EXCEPTION 'migration backfill left % account balance mismatches; stored balances were not rewritten', bad_accounts;
	END IF;
END $$;
