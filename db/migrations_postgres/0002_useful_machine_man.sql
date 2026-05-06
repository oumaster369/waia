CREATE TABLE "waia_postgres_tx_validation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
