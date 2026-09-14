-- Custom SQL migration file, put your code below! --
INSERT INTO "users" ("name") VALUES
	('User A'),
	('User B'),
	('User C'),
	('User D');

INSERT INTO "accounts" ("user_id", "balance")
SELECT "id", 0 FROM "users" WHERE "name" IN ('User A', 'User B', 'User C', 'User D');
