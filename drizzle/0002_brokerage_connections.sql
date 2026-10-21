-- IF NOT EXISTS: the Python API (db.py) may create this table first, with the same columns and inline foreign key.
CREATE TABLE IF NOT EXISTS "brokerage_connections" (
	"user_id" text PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"snaptrade_user_id" text NOT NULL,
	"sealed_user" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
