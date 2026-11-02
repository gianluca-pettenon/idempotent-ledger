-- Read model projected from KurrentDB. Disposable: drop it and the projector rebuilds it from the events.

CREATE TABLE IF NOT EXISTS users (
	id   text PRIMARY KEY,
	name text NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
	user_id text PRIMARY KEY,
	balance bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
	id                   text PRIMARY KEY,
	user_id              text NOT NULL,
	type                 text NOT NULL,
	amount               bigint NOT NULL,
	counterparty_user_id text,
	created_at           timestamptz NOT NULL,
	position             bigint NOT NULL -- $all commit position, the true event order
);

CREATE INDEX IF NOT EXISTS transactions_user_position ON transactions (user_id, position DESC);

-- Last $all position applied, written in the same transaction as the projection.
CREATE TABLE IF NOT EXISTS checkpoint (
	id      boolean PRIMARY KEY DEFAULT true CHECK (id),
	commit  bigint NOT NULL,
	prepare bigint NOT NULL
);
